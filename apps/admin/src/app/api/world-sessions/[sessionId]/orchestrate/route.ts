import { NextRequest, NextResponse } from "next/server";
import {
  getCharacterStore,
  getVoiceStore,
  getWorldSessionStore,
} from "@odyssey/db";
import { type Scene, type SceneState } from "@odyssey/types";
import {
  buildSceneDecisionRequest,
  buildSceneSessionSnapshot,
  createInitialSceneState,
  defaultSceneDecision,
  fallbackSceneDecisionResolution,
  getScene,
  readSceneMemoryFromSnapshot,
  readSceneStateFromSnapshot,
  resolveSceneDecision,
  updateSceneMemory,
} from "@odyssey/orchestration/client";
import { resolveOrchestratorExecutor } from "@/lib/orchestrator-executor";
import { TraceEnvelope } from "@/lib/voice-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/world-sessions/:sessionId/orchestrate
 *
 * Decides what happens next in a multi-character scene: who speaks, what
 * beat they're on, what ambience plays. The client may still post scene
 * state for backwards compatibility, but the route now reads and writes
 * canonical scene state + compact scene memory in world_sessions.current_scene.
 *
 * Provider execution is OpenAI-compatible chat completions with structured
 * JSON output. If no configured provider is available, return a sensible
 * default ("wait-for-user") so the scene can still run, just without
 * scene-led behavior.
 */

const RECENT_TURNS_LIMIT = 6;
const CHARACTER_SANDBOX_SCENE_PREFIX = "character-sandbox:";

type RecentTurn = {
  speakerSlug: string;     // character slug, "user", or "narrator"
  speakerName?: string;    // display name for readability in the prompt
  text: string;            // the line that was spoken
};

type OrchestrateBody = {
  sceneId?: string;
  sceneState?: SceneState;
  sceneMemory?: string[];
  recentTurns?: RecentTurn[];
  // Optional: a user message that just arrived, in case it should bias the
  // decision (e.g. user directly addressed a character by name).
  lastUserMessage?: string;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  const trace = new TraceEnvelope();
  trace.mark("orchestrate.request.received", { sessionId });

  let body: OrchestrateBody;
  try {
    trace.mark("orchestrate.body.parse.start");
    body = (await req.json()) as OrchestrateBody;
    trace.mark("orchestrate.body.parse.done");
  } catch {
    trace.mark("orchestrate.body.parse.error");
    return NextResponse.json(
      { error: "Invalid JSON body.", trace: trace.toJSON() },
      { status: 400 },
    );
  }

  const sceneId = body.sceneId?.trim();
  if (!sceneId) {
    trace.mark("orchestrate.scene.missing");
    return NextResponse.json(
      { error: "sceneId is required", trace: trace.toJSON() },
      { status: 400 },
    );
  }

  const scene = await resolveScene(sceneId);
  if (!scene) {
    trace.mark("orchestrate.scene.unknown", { sceneId });
    return NextResponse.json(
      { error: `Unknown sceneId: ${sceneId}`, trace: trace.toJSON() },
      { status: 404 },
    );
  }
  trace.mark("orchestrate.scene.loaded", {
    sceneId: scene.id,
    characters: scene.characters.length,
  });

  const store = getWorldSessionStore();
  trace.mark("orchestrate.session.load.start");
  const session = await store.getSession(sessionId).catch((sessionErr) => {
    trace.mark("orchestrate.session.load.error", {
      message: sessionErr instanceof Error ? sessionErr.message : String(sessionErr),
    });
    console.error("[orchestrate] getSession failed", sessionErr);
    return null;
  });
  trace.mark("orchestrate.session.load.done", { found: Boolean(session) });
  const sceneState: SceneState =
    body.sceneState ??
    readSceneStateFromSnapshot(session?.currentScene, scene.id) ??
    createInitialSceneState(scene);
  const previousSceneMemory =
    body.sceneMemory ?? readSceneMemoryFromSnapshot(session?.currentScene, scene.id);

  const recentTurns = (body.recentTurns ?? []).slice(-RECENT_TURNS_LIMIT);
  const sceneMemory = updateSceneMemory({
    previousMemory: previousSceneMemory,
    recentTurns,
  });
  trace.mark("orchestrate.memory.updated", {
    previousMemoryCount: previousSceneMemory.length,
    recentTurnCount: recentTurns.length,
    sceneMemoryCount: sceneMemory.length,
    turnIndex: sceneState.turnIndex,
  });
  const decisionRequest = buildSceneDecisionRequest({
    scene,
    sceneState,
    recentTurns,
    sceneMemory,
    lastUserMessage: body.lastUserMessage,
  });
  trace.mark("orchestrate.request.built", decisionRequest.trace);

  const executorResolution = resolveOrchestratorExecutor();
  if (!executorResolution.executor) {
    trace.mark("orchestrate.provider.unavailable", {
      reason: executorResolution.reason ?? "unknown",
    });
    trace.mark("orchestrate.response.ready", {
      action: "wait-for-user",
      degraded: true,
    });
    // Degrade gracefully — the scene can still run with the user driving.
    return NextResponse.json({
      decision: defaultSceneDecision(scene, sceneState),
      sceneState,
      sceneMemory,
      degraded: true,
      reason: executorResolution.reason,
      trace: trace.toJSON(),
    });
  }
  const executor = executorResolution.executor;
  trace.mark("orchestrate.provider.resolved", {
    provider: executor.provider,
    model: executor.model,
  });

  try {
    trace.mark("orchestrate.llm.start", {
      provider: executor.provider,
      model: executor.model,
    });
    const rawDecision = await executor.execute(decisionRequest);
    trace.mark("orchestrate.llm.done", {
      provider: executor.provider,
      model: executor.model,
    });
    const resolution = resolveSceneDecision({ scene, sceneState }, rawDecision);
    trace.mark("orchestrate.decision.resolved", {
      action: resolution.decision.action,
      speakerSlug: resolution.speakerSlug,
      degraded: resolution.degraded,
      reason: resolution.reason ?? null,
      turnIndex: resolution.sceneState.turnIndex,
    });

    // Best-effort persistence of the decision as an event so the workbench
    // can replay scene history. Non-fatal if it fails.
    try {
      trace.mark("orchestrate.persistence.start", {
        eventCount: resolution.events.length,
      });
      for (const event of resolution.events) {
        await store.appendEvent({
          sessionId,
          type: event.type,
          source: event.source,
          payload: {
            ...event.payload,
            orchestrator: {
              provider: executor.provider,
              model: executor.model,
            },
            requestTrace: decisionRequest.trace,
            trace: trace.toJSON(),
          },
        });
      }
      await store.updateCurrentScene({
        sessionId,
        currentScene: buildSceneSessionSnapshot(resolution.sceneState, {
          sceneMemory,
        }),
      });
      trace.mark("orchestrate.persistence.done");
    } catch (eventErr) {
      trace.mark("orchestrate.persistence.error", {
        message: eventErr instanceof Error ? eventErr.message : String(eventErr),
      });
      console.error("[orchestrate] persistence failed", eventErr);
    }

    trace.mark("orchestrate.response.ready", {
      action: resolution.decision.action,
      speakerSlug: resolution.speakerSlug,
    });
    return NextResponse.json({
      decision: resolution.decision,
      sceneState: resolution.sceneState,
      sceneMemory,
      orchestrator: {
        provider: executor.provider,
        model: executor.model,
      },
      degraded: resolution.degraded || undefined,
      reason: resolution.reason,
      trace: trace.toJSON(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace.mark("orchestrate.error", {
      provider: executor.provider,
      model: executor.model,
      message,
    });
    const resolution = fallbackSceneDecisionResolution({ scene, sceneState }, message);
    try {
      trace.mark("orchestrate.persistence.start", {
        eventCount: resolution.events.length,
        degraded: true,
      });
      for (const event of resolution.events) {
        await store.appendEvent({
          sessionId,
          type: event.type,
          source: event.source,
          payload: {
            ...event.payload,
            orchestrator: {
              provider: executor.provider,
              model: executor.model,
            },
            requestTrace: decisionRequest.trace,
            trace: trace.toJSON(),
          },
        });
      }
      await store.updateCurrentScene({
        sessionId,
        currentScene: buildSceneSessionSnapshot(resolution.sceneState, {
          sceneMemory,
        }),
      });
      trace.mark("orchestrate.persistence.done");
    } catch (eventErr) {
      trace.mark("orchestrate.persistence.error", {
        message: eventErr instanceof Error ? eventErr.message : String(eventErr),
      });
      console.error("[orchestrate] degraded persistence failed", eventErr);
    }
    trace.mark("orchestrate.response.ready", {
      action: resolution.decision.action,
      degraded: true,
    });
    console.error(`[orchestrate] ${executor.provider} call failed`, message);
    return NextResponse.json({
      decision: resolution.decision,
      sceneState: resolution.sceneState,
      sceneMemory,
      degraded: true,
      reason: message,
      orchestrator: {
        provider: executor.provider,
        model: executor.model,
      },
      trace: trace.toJSON(),
    });
  }
}

async function resolveScene(sceneId: string): Promise<Scene | null> {
  const authored = getScene(sceneId);
  if (authored) return authored;

  if (!sceneId.startsWith(CHARACTER_SANDBOX_SCENE_PREFIX)) return null;
  const slugOrId = sceneId.slice(CHARACTER_SANDBOX_SCENE_PREFIX.length).trim();
  if (!slugOrId) return null;

  const store = getCharacterStore();
  const character =
    (await store.getBySlug(slugOrId).catch(() => null)) ??
    (await store.getById(slugOrId).catch(() => null));
  if (!character) return null;

  const voice = character.voiceId
    ? await getVoiceStore().getById(character.voiceId).catch(() => null)
    : null;
  const displayName = character.title?.trim() || character.slug;
  const summary = character.summary?.trim();

  return {
    id: sceneId,
    title: `${displayName} sandbox`,
    description: [
      `A live single-character sandbox for ${displayName}.`,
      "The user is directly testing this character in the admin workbench.",
      `After each user message, choose action "speak" with speakerId "${character.slug}" unless the user explicitly ends the session.`,
      "Use wait-for-user only before the user has spoken or after the character has already answered.",
    ].join(" "),
    characters: [
      {
        characterSlug: character.slug,
        displayName,
        voice: voice?.slug ?? character.slug,
        blurb:
          summary ??
          `The authored character under test. Responds as ${displayName} using the character's configured identity, directive, voice style, model, and knowledge bindings.`,
      },
    ],
    openingBeat: `${displayName} is ready in the sandbox and waiting for the user to begin.`,
    defaultAmbience: null,
    narratorVoice: "fable",
  };
}
