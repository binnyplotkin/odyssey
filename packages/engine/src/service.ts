import { getPersistenceStore, getWorldRepository } from "@odyssey/db";
import { RuleBasedEventSelector } from "./event-selector";
import { RollingMemorySummarizer } from "./memory-summarizer";
import { DefaultPolicyGuard } from "./policy-guard";
import { HeuristicStateReducer } from "./state-reducer";
import { TurnProcessor, TurnTraceStep } from "./turn-processor";
import { buildWorldDefinitionFromPrompt } from "./world-builder";
import { StaticWorldLoader } from "./world-loader";
import {
  createDefaultTextGenerationProvider,
  getDeterministicTextGenerationAdapter,
} from "./text-generation-provider";
import { TextGenerationAdapter, TextGenerationProvider } from "./interfaces";
import { createId, isoNow } from "@odyssey/utils";
import {
  BuildWorldResponse,
  sessionRecordSchema,
  SessionRecord,
  TurnRecord,
  turnInputSchema,
  visibleWorldSchema,
  VisibleWorld,
  worldBuildRequestSchema,
  worldBuildResponseSchema,
  worldDefinitionSchema,
  WorldDefinition,
} from "@odyssey/types";

type CreateSimulationServiceOptions = {
  textGenerationProvider?: TextGenerationProvider;
  textGenerationAdapter?: TextGenerationAdapter;
};

function createTurnProcessor(adapter: TextGenerationAdapter) {
  return new TurnProcessor(
    new HeuristicStateReducer(),
    new RuleBasedEventSelector(),
    new RollingMemorySummarizer(),
    new DefaultPolicyGuard(),
    adapter,
  );
}

function buildSeedSession(session: SessionRecord, world: WorldDefinition) {
  return sessionRecordSchema.parse({
    id: session.id,
    worldId: session.worldId,
    roleId: session.roleId,
    status: session.status,
    createdAt: session.createdAt,
    lastActiveAt: session.createdAt,
    currentStateVersion: 1,
    state: {
      ...world.initialState,
      turnCount: 0,
      activeEventId: null,
      lastEventIds: [],
    },
  });
}

function buildVisibleState(state: SessionRecord["state"]) {
  return {
    politicalStability: state.politicalStability,
    publicSentiment: state.publicSentiment,
    treasury: state.treasury,
    militaryPressure: state.militaryPressure,
    factionInfluence: state.factionInfluence,
  };
}

export function createSimulationService(
  staticWorlds: WorldDefinition[] = [],
  options: CreateSimulationServiceOptions = {},
) {
  const worldLoader = new StaticWorldLoader(staticWorlds);
  const generationAdapter =
    options.textGenerationAdapter ??
    options.textGenerationProvider?.createAdapter() ??
    createDefaultTextGenerationProvider().createAdapter();
  const turnProcessor = createTurnProcessor(generationAdapter);
  const replayTurnProcessor = createTurnProcessor(getDeterministicTextGenerationAdapter());

  async function listWorlds(): Promise<VisibleWorld[]> {
    const worlds = await getWorldRepository(staticWorlds).listWorlds();
    return worlds.map((world) => visibleWorldSchema.parse(world));
  }

  async function getVisibleWorldById(worldId: string) {
    const world = await worldLoader.getWorld(worldId);

    if (!world) {
      return null;
    }

    return visibleWorldSchema.parse(world);
  }

  async function getWorldDetailById(worldId: string) {
    return getWorldRepository(staticWorlds).getWorldDetail(worldId);
  }

  async function updateWorldDefinition(worldId: string, rawDefinition: unknown) {
    const definition = worldDefinitionSchema.parse({
      ...(rawDefinition as Record<string, unknown>),
      id: worldId,
    });

    return getWorldRepository(staticWorlds).updateWorld({ worldId, definition });
  }

  async function buildWorldFromPrompt(rawInput: unknown): Promise<BuildWorldResponse> {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "World builder strict mode requires DATABASE_URL so generated worlds can be persisted.",
      );
    }

    const { prompt } = worldBuildRequestSchema.parse(rawInput);
    const definition = await buildWorldDefinitionFromPrompt(prompt);
    const record = await getWorldRepository(staticWorlds)
      .createWorldFromDefinition({
        prompt,
        definition,
        status: "published",
      })
      .catch((error: unknown) => {
        const code =
          (error as { code?: string })?.code ??
          (error as { cause?: { code?: string } })?.cause?.code;

        if (code === "42P01") {
          throw new Error("World builder requires the worlds table. Run `npm run db:push` first.");
        }

        throw error;
      });

    const response = worldBuildResponseSchema.parse({
      world: visibleWorldSchema.parse(record.definition),
      worldId: record.id,
      roleId: record.definition.roles[0].id,
      published: true,
    });

    return response;
  }

  async function startSession(worldId: string, roleId: string) {
    const world = await worldLoader.getWorld(worldId);

    if (!world) {
      throw new Error(`Unknown world: ${worldId}`);
    }

    const role = world.roles.find((candidate) => candidate.id === roleId);

    if (!role) {
      throw new Error(`Unknown role: ${roleId}`);
    }

    const timestamp = isoNow();
    const session = sessionRecordSchema.parse({
      id: createId("session"),
      worldId,
      roleId,
      status: "active",
      createdAt: timestamp,
      lastActiveAt: timestamp,
      currentStateVersion: 1,
      state: {
        ...world.initialState,
        turnCount: 0,
        activeEventId: null,
        lastEventIds: [],
      },
    });

    await getPersistenceStore().createSession(session);

    return session;
  }

  async function resumeSession(sessionId: string) {
    return getPersistenceStore().getSession(sessionId);
  }

  async function listRecentSessions() {
    const sessions = await getPersistenceStore().listSessions();

    return sessions.map((session) => ({
      id: session.id,
      worldId: session.worldId,
      roleId: session.roleId,
      status: session.status,
      lastActiveAt: session.lastActiveAt,
      currentStateVersion: session.currentStateVersion,
    }));
  }

  async function processTurn(
    sessionId: string,
    rawInput: unknown,
    options?: { onTextDelta?: (delta: string) => void | Promise<void> },
  ) {
    const input = turnInputSchema.parse(rawInput);
    const store = getPersistenceStore();
    const session = await store.getSession(sessionId);

    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const world = await worldLoader.getWorld(session.worldId);

    if (!world) {
      throw new Error(`Unknown world: ${session.worldId}`);
    }

    const { session: updatedSession, turn } = await turnProcessor.process(world, session, input, {
      onTextDelta: options?.onTextDelta,
    });

    await store.updateSession(updatedSession);
    await store.appendTurn(turn);

    return {
      session: updatedSession,
      turn,
    };
  }

  async function getSessionTurns(sessionId: string) {
    return getPersistenceStore().getTurns(sessionId);
  }

  async function replaySession(sessionId: string) {
    const store = getPersistenceStore();
    const session = await store.getSession(sessionId);

    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const world = await worldLoader.getWorld(session.worldId);

    if (!world) {
      throw new Error(`Unknown world: ${session.worldId}`);
    }

    const turns = (await store.getTurns(sessionId)).slice().sort((a, b) => {
      if (a.stateVersion === b.stateVersion) {
        return a.createdAt.localeCompare(b.createdAt);
      }

      return a.stateVersion - b.stateVersion;
    });

    let replaySessionState = buildSeedSession(session, world);
    const mismatches: Array<{
      turnId: string;
      stateVersion: number;
      reason: string;
    }> = [];
    const replayedTurns: TurnRecord[] = [];

    for (const persistedTurn of turns) {
      const replayed = await replayTurnProcessor.process(
        world,
        replaySessionState,
        persistedTurn.input,
      );
      replaySessionState = replayed.session;
      replayedTurns.push(replayed.turn);

      const visibleStateMatches =
        JSON.stringify(buildVisibleState(replayed.session.state)) ===
        JSON.stringify(persistedTurn.result.visibleState);
      const summaryMatches = replayed.turn.stateDeltaSummary === persistedTurn.stateDeltaSummary;
      const stateVersionMatches = replayed.turn.stateVersion === persistedTurn.stateVersion;

      if (!summaryMatches) {
        mismatches.push({
          turnId: persistedTurn.id,
          stateVersion: persistedTurn.stateVersion,
          reason: "State summary changed during replay.",
        });
      }

      if (!stateVersionMatches) {
        mismatches.push({
          turnId: persistedTurn.id,
          stateVersion: persistedTurn.stateVersion,
          reason: "State version diverged during replay.",
        });
      }

      if (!visibleStateMatches) {
        mismatches.push({
          turnId: persistedTurn.id,
          stateVersion: persistedTurn.stateVersion,
          reason: "Replay visible state diverged from persisted turn state.",
        });
      }
    }

    if (session.currentStateVersion !== replaySessionState.currentStateVersion) {
      mismatches.push({
        turnId: "final-session",
        stateVersion: replaySessionState.currentStateVersion,
        reason: "Final session state version diverged from persisted session record.",
      });
    }

    return {
      sessionId,
      worldId: session.worldId,
      turnCount: turns.length,
      matches: mismatches.length === 0,
      mismatches,
      finalStateVersion: replaySessionState.currentStateVersion,
      finalState: replaySessionState.state,
      replayedTurns,
    };
  }

  async function traceTurnPipeline(rawInput: unknown) {
    const body = rawInput as {
      worldId?: string;
      roleId?: string;
      text?: string;
      mode?: "text" | "voice";
      clientTimestamp?: string;
    };

    if (!body.worldId || !body.roleId || !body.text?.trim()) {
      throw new Error("worldId, roleId, and text are required.");
    }

    const world = await worldLoader.getWorld(body.worldId);

    if (!world) {
      throw new Error(`Unknown world: ${body.worldId}`);
    }

    const role = world.roles.find((candidate) => candidate.id === body.roleId);

    if (!role) {
      throw new Error(`Unknown role: ${body.roleId}`);
    }

    const timestamp = isoNow();
    const input = turnInputSchema.parse({
      mode: body.mode ?? "text",
      text: body.text,
      clientTimestamp: body.clientTimestamp ?? timestamp,
    });

    const session = sessionRecordSchema.parse({
      id: createId("session"),
      worldId: world.id,
      roleId: role.id,
      status: "active",
      createdAt: timestamp,
      lastActiveAt: timestamp,
      currentStateVersion: 1,
      state: {
        ...world.initialState,
        turnCount: 0,
        activeEventId: null,
        lastEventIds: [],
      },
    });

    const trace: TurnTraceStep[] = [
      {
        id: "request-input",
        label: "Request Input",
        data: {
          worldId: world.id,
          worldTitle: world.title,
          roleId: role.id,
          roleTitle: role.title,
          input,
        },
      },
      {
        id: "session-seed",
        label: "Initial Session Seed",
        data: session,
      },
    ];

    const traceStartedAt = Date.now();
    const processed = await turnProcessor.process(world, session, input, {
      recordTrace: (step) => {
        trace.push(step);
      },
    });
    const durationMs = Date.now() - traceStartedAt;

    trace.push({
      id: "persistence-preview",
      label: "Persistence Writes (Preview)",
      data: {
        store: process.env.DATABASE_URL ? "neon" : "memory",
        updateSession: processed.session,
        appendTurn: processed.turn,
      },
    });
    trace.push({
      id: "response-envelope",
      label: "API Response Envelope",
      data: processed,
    });
    trace.push({
      id: "trace-metrics",
      label: "Trace Metrics",
      data: {
        durationMs,
        estimatedCostUsd: null,
        estimatedCostReason: "Usage metadata is not yet exposed by the generation adapter.",
      },
    });

    return {
      meta: {
        worldId: world.id,
        worldTitle: world.title,
        roleId: role.id,
        roleTitle: role.title,
        generationMode: process.env.OPENAI_API_KEY
          ? "openai-with-fallback"
          : "fallback-only",
        persistenceMode: process.env.DATABASE_URL ? "neon" : "memory",
        durationMs,
        estimatedCostUsd: null,
      },
      trace,
    };
  }

  function createIntroResult(session: SessionRecord, world: VisibleWorld) {
    const narratorVoice = world.narratorVoice?.voiceId ?? "alloy";

    return {
      world,
      session,
      intro: {
        transcript: "",
        narration: [
          {
            id: createId("narration"),
            speaker: "narrator" as const,
            text: world.introNarration,
          },
        ],
        dialogue: [],
        uiChoices: [
          "Hold open court",
          "Ask the chancellor for a briefing",
          "Demand the military report",
        ],
        visibleState: {
          politicalStability: session.state.politicalStability,
          publicSentiment: session.state.publicSentiment,
          treasury: session.state.treasury,
          militaryPressure: session.state.militaryPressure,
          factionInfluence: session.state.factionInfluence,
        },
        privateStateVersion: session.currentStateVersion,
        event: null,
        audioDirectives: [
          {
            type: "speak" as const,
            voice: narratorVoice,
            text: world.introNarration,
          },
        ],
      },
    };
  }

  return {
    listWorlds,
    getVisibleWorldById,
    getWorldDetailById,
    updateWorldDefinition,
    buildWorldFromPrompt,
    startSession,
    resumeSession,
    listRecentSessions,
    processTurn,
    getSessionTurns,
    replaySession,
    traceTurnPipeline,
    createIntroResult,
  };
}
