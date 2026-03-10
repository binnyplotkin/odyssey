import { getVisibleWorlds } from "@/data/worlds";
import { getPersistenceStore } from "@/lib/db/store";
import { RuleBasedEventSelector } from "@/lib/simulation/event-selector";
import { RollingMemorySummarizer } from "@/lib/simulation/memory-summarizer";
import { DefaultPolicyGuard } from "@/lib/simulation/policy-guard";
import { HeuristicStateReducer } from "@/lib/simulation/state-reducer";
import { TurnProcessor } from "@/lib/simulation/turn-processor";
import { StaticWorldLoader } from "@/lib/simulation/world-loader";
import { createId, isoNow } from "@/lib/utils";
import {
  sessionRecordSchema,
  SessionRecord,
  turnInputSchema,
  VisibleWorld,
} from "@/types/simulation";

const worldLoader = new StaticWorldLoader();
const turnProcessor = new TurnProcessor(
  new HeuristicStateReducer(),
  new RuleBasedEventSelector(),
  new RollingMemorySummarizer(),
  new DefaultPolicyGuard(),
);

export async function listWorlds(): Promise<VisibleWorld[]> {
  return getVisibleWorlds();
}

export async function startSession(worldId: string, roleId: string) {
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

export async function resumeSession(sessionId: string) {
  return getPersistenceStore().getSession(sessionId);
}

export async function listRecentSessions() {
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

export async function processTurn(sessionId: string, rawInput: unknown) {
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

  const { session: updatedSession, turn } = await turnProcessor.process(world, session, input);

  await store.updateSession(updatedSession);
  await store.appendTurn(turn);

  return {
    session: updatedSession,
    turn,
  };
}

export async function getSessionTurns(sessionId: string) {
  return getPersistenceStore().getTurns(sessionId);
}

export function createIntroResult(session: SessionRecord, world: VisibleWorld) {
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
          voice: "alloy",
          text: world.introNarration,
        },
      ],
    },
  };
}
