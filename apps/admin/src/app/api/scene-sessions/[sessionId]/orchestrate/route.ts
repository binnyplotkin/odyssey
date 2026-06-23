import { NextRequest, NextResponse } from "next/server";
import { getSceneSessionStore } from "@odyssey/db";
import { type OrchestratorDecision, type SceneState } from "@odyssey/types";
import {
  buildSceneDecisionRequest,
  buildSceneSessionSnapshot,
  createInitialSceneState,
  defaultSceneDecision,
  fallbackSceneDecisionResolution,
  readSceneMemoryFromSnapshot,
  readSceneStateFromSnapshot,
  resolveSceneDecision,
  type SceneDecisionResolution,
  updateSceneMemory,
} from "@odyssey/orchestration/client";
import { resolveOrchestratorExecutor } from "@/lib/orchestrator-executor";
import { resolveScene } from "@/lib/scene-orchestration";
import { TraceEnvelope } from "@/lib/voice-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scene-sessions/:sessionId/orchestrate
 *
 * Decides what happens next in a scene: who speaks, what beat they're on,
 * what ambience plays. Reads/writes canonical scene state + compact scene
 * memory in scene_sessions.current_scene.
 *
 * Provider execution is OpenAI-compatible chat completions with structured
 * JSON output. If no configured provider is available, return a sensible
 * default ("wait-for-user") so the scene can still run.
 */

const RECENT_TURNS_LIMIT = 6;

type RecentTurn = {
  speakerSlug: string;
  speakerName?: string;
  text: string;
};

type OrchestrateBody = {
  sceneId?: string;
  sceneState?: SceneState;
  sceneMemory?: string[];
  recentTurns?: RecentTurn[];
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

  const store = getSceneSessionStore();
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

  // Shared persistence + response for a resolved decision — used by the
  // single-character fast-path, the LLM success path, and the LLM-failure
  // fallback so all three persist events identically and return the same
  // response shape.
  const respond = async (
    resolution: SceneDecisionResolution,
    orchestrator: { provider: string; model: string } | null,
  ) => {
    const degraded = resolution.degraded || undefined;
    try {
      trace.mark("orchestrate.persistence.start", {
        eventCount: resolution.events.length,
        ...(degraded ? { degraded: true } : {}),
      });
      for (const event of resolution.events) {
        await store.appendEvent({
          sessionId,
          type: event.type,
          source: event.source,
          payload: {
            ...event.payload,
            ...(orchestrator ? { orchestrator } : {}),
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
      ...(degraded ? { degraded: true } : {}),
    });
    return NextResponse.json({
      decision: resolution.decision,
      sceneState: resolution.sceneState,
      sceneMemory,
      ...(orchestrator ? { orchestrator } : {}),
      degraded,
      reason: resolution.reason,
      trace: trace.toJSON(),
    });
  };

  // ── Single-character fast-path ────────────────────────────────────────
  // With exactly one character present, the orchestrator's core decision —
  // who speaks next — has only one answer, so the ~0.9–1.1s blocking
  // orchestrator LLM call (groq/cerebras gpt-oss-120b) is pure latency for no
  // real choice. Synthesize the decision directly: "speak" for that character
  // once the user has spoken, otherwise "wait-for-user". This removes the
  // dominant per-turn cost for single-character sandbox scenes
  // (character-sandbox:<slug>). Multi-character scenes fall through to the
  // real orchestrator below.
  const presentSoloSlugs = sceneState.presentCharacterSlugs.filter((slug) =>
    scene.characters.some((c) => c.characterSlug === slug),
  );
  if (presentSoloSlugs.length === 1) {
    const soloSlug = presentSoloSlugs[0];
    const userHasSpoken =
      Boolean(body.lastUserMessage?.trim()) ||
      recentTurns[recentTurns.length - 1]?.speakerSlug === "user";
    const rawDecision: OrchestratorDecision = userHasSpoken
      ? { action: "speak", speakerId: soloSlug }
      : defaultSceneDecision(scene, sceneState);
    trace.mark("orchestrate.fastpath", {
      reason: "single-character-scene",
      action: rawDecision.action,
      speakerId: userHasSpoken ? soloSlug : null,
    });
    const resolution = resolveSceneDecision({ scene, sceneState }, rawDecision);
    return respond(resolution, {
      provider: "fastpath",
      model: "single-character",
    });
  }

  const executorResolution = resolveOrchestratorExecutor();
  if (!executorResolution.executor) {
    trace.mark("orchestrate.provider.unavailable", {
      reason: executorResolution.reason ?? "unknown",
    });
    trace.mark("orchestrate.response.ready", {
      action: "wait-for-user",
      degraded: true,
    });
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

    return respond(resolution, {
      provider: executor.provider,
      model: executor.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace.mark("orchestrate.error", {
      provider: executor.provider,
      model: executor.model,
      message,
    });
    const resolution = fallbackSceneDecisionResolution({ scene, sceneState }, message);
    console.error(`[orchestrate] ${executor.provider} call failed`, message);
    return respond(resolution, {
      provider: executor.provider,
      model: executor.model,
    });
  }
}
