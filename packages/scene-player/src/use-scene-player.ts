"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrchestratorDecision, Scene, SceneState } from "@odyssey/types";
import {
  buildSpeakerTurnRequest,
  createInitialSceneState,
  resolveSceneDecision,
  type SpeakerTurnRequest,
} from "@odyssey/orchestration/client";
import { SceneAudioBus } from "./scene-audio-bus";

// Trace payloads are opaque JSON the player forwards from the orchestrate /
// voice-stream APIs straight to the consumer's trace UI — the player never
// introspects them, so it stays decoupled from any app-specific trace schema.
export type TracePayload = Record<string, unknown>;
export type TraceContract = Record<string, unknown>;

/**
 * Scene runner — owns the orchestration loop for a multi-character scene.
 *
 * Phase 1 design choices:
 *  - Scene state lives in this hook during a run and is mirrored into
 *    scene_sessions.current_scene by the orchestrate route.
 *  - Voice playback is gapless via SceneAudioBus's per-frame scheduling.
 *  - Barge-in: caller invokes sendUserMessage(); we stop voice, push the
 *    user's turn, and re-enter the loop with their message as a bias.
 *  - User input source is caller-owned (mic STT, text input, whatever)
 *    — the runner only cares about strings arriving via sendUserMessage.
 *
 * Still additive: resume hydration, concurrent speakers, SFX.
 */

export type SceneTurn = {
  id?: string;
  speakerSlug: string;       // character slug, "user", or "narrator"
  speakerName?: string;
  text: string;
};

export type ScenePhase =
  | "idle"             // scene hasn't started, or has ended
  | "deciding"         // orchestrator call in flight
  | "speaking"         // a character is speaking
  | "narrating"        // narrator is speaking
  | "waiting-for-user" // orchestrator handed control to the user
  | "error";

export type SceneRunnerTrace = {
  id: string;
  kind: "orchestrator" | "voice";
  at: string;
  trace: TracePayload;
  meta: {
    sessionId: string;
    sceneId?: string;
    turnId?: string;
    action?: OrchestratorDecision["action"];
    speakerSlug?: string | null;
    provider?: string | null;
    model?: string | null;
    degraded?: boolean;
    reason?: string | null;
    firstAudioMs?: number | null;
    totalMs?: number | null;
  };
};

export type UseSceneRunnerOptions = {
  scene: Scene;
  sessionId: string;
  // Optional turnId per voice-stream call; if absent, runner generates a
  // random id per turn so persistence still associates audio with turns.
  generateTurnId?: () => string;
};

export type UseSceneRunnerResult = {
  phase: ScenePhase;
  sceneState: SceneState;
  turns: SceneTurn[];
  traces: SceneRunnerTrace[];
  latestTrace: SceneRunnerTrace | null;
  currentSpeakerSlug: string | null;
  error: string | null;
  start: () => Promise<void>;
  sendUserMessage: (text: string, options?: { turnId?: string }) => Promise<void>;
  stop: () => void;
};

const RECENT_TURNS_LIMIT = 8;

export function useScenePlayer(opts: UseSceneRunnerOptions): UseSceneRunnerResult {
  const { scene, sessionId } = opts;
  const generateTurnId = opts.generateTurnId ?? (() => crypto.randomUUID());

  const [phase, setPhase] = useState<ScenePhase>("idle");
  const [turns, setTurns] = useState<SceneTurn[]>([]);
  const [traces, setTraces] = useState<SceneRunnerTrace[]>([]);
  const [currentSpeakerSlug, setCurrentSpeakerSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sceneState, setSceneState] = useState<SceneState>(() => ({
    ...createInitialSceneState(scene),
  }));

  // Refs that mirror state for use inside the async loop. State setters
  // are async w.r.t. when the next loop iteration reads them, so we keep
  // a ref shadow for the runner's own consumption.
  const sceneStateRef = useRef(sceneState);
  const turnsRef = useRef<SceneTurn[]>(turns);
  const busRef = useRef<SceneAudioBus | null>(null);
  const runningRef = useRef(false);
  const voiceStreamAbortRef = useRef<AbortController | null>(null);
  const loopGenerationRef = useRef(0);

  useEffect(() => {
    sceneStateRef.current = sceneState;
  }, [sceneState]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const ensureBus = useCallback((): SceneAudioBus => {
    if (!busRef.current) busRef.current = new SceneAudioBus();
    busRef.current.start();
    return busRef.current;
  }, []);

  const pushTurn = useCallback((turn: SceneTurn) => {
    setTurns((prev) => [...prev, turn]);
    turnsRef.current = [...turnsRef.current, turn];
  }, []);

  const pushTrace = useCallback((trace: SceneRunnerTrace | null | undefined) => {
    if (!trace) return;
    setTraces((prev) => [...prev.slice(-49), trace]);
  }, []);

  const applyDecision = useCallback(
    (decision: OrchestratorDecision, newSpeakerSlug: string | null) => {
      setSceneState((prev) => {
        const resolved = resolveSceneDecision({ scene, sceneState: prev }, decision);
        const next = {
          ...resolved.sceneState,
          lastSpeakerSlug: newSpeakerSlug ?? resolved.sceneState.lastSpeakerSlug,
        };
        sceneStateRef.current = next;
        return next;
      });
    },
    [scene],
  );

  /** One iteration of the orchestration loop. Returns when control is
   *  handed back to the user (action: wait-for-user / end-scene) or the
   *  runner is stopped. */
  const tick = useCallback(
    async (generation: number, lastUserMessage?: string): Promise<void> => {
      if (!runningRef.current) return;
      if (generation !== loopGenerationRef.current) return;
      try {
        setPhase("deciding");
        const orchestratorResult = await fetchOrchestratorDecision({
          sessionId,
          sceneId: scene.id,
          sceneState: sceneStateRef.current,
          recentTurns: turnsRef.current
            .slice(-RECENT_TURNS_LIMIT)
            .map((t) => ({
              speakerSlug: t.speakerSlug,
              speakerName: t.speakerName,
              text: t.text,
            })),
          lastUserMessage,
        });
        const decision = orchestratorResult.decision;
        pushTrace({
          id: crypto.randomUUID(),
          kind: "orchestrator",
          at: new Date().toISOString(),
          trace: orchestratorResult.trace,
          meta: {
            sessionId,
            sceneId: scene.id,
            action: decision.action,
            speakerSlug: decision.action === "speak" ? decision.speakerId ?? null : null,
            provider: orchestratorResult.orchestrator?.provider ?? null,
            model: orchestratorResult.orchestrator?.model ?? null,
            degraded: orchestratorResult.degraded ?? false,
            reason: orchestratorResult.reason ?? null,
          },
        });

        if (!runningRef.current || generation !== loopGenerationRef.current) return;

        // Apply ambience change first so the audio bed matches whatever
        // happens next (speak/narrate/wait).
        const bus = ensureBus();
        if (decision.ambience !== undefined) {
          bus.setAmbience(decision.ambience);
        }

        if (decision.action === "wait-for-user") {
          applyDecision(decision, null);
          setCurrentSpeakerSlug(null);
          setPhase("waiting-for-user");
          return;
        }

        if (decision.action === "end-scene") {
          applyDecision(decision, null);
          setCurrentSpeakerSlug(null);
          setPhase("idle");
          runningRef.current = false;
          return;
        }

        if (decision.action === "narrate") {
          const text = decision.narration?.trim();
          if (!text) {
            // Skip an empty narrate and re-decide.
            applyDecision(decision, null);
            return tick(generation);
          }
          const turnId = generateTurnId();
          setCurrentSpeakerSlug("narrator");
          setPhase("narrating");
          pushTurn({ id: turnId, speakerSlug: "narrator", text });
          const narration = await playNarration(
            bus,
            text,
            scene.narratorVoice ?? scene.characters[0].voice,
          );
          void persistSceneTurn({
            sessionId,
            turnId,
            inputMode: "narration",
            speakerSlug: "narrator",
            assistantText: text,
            provider: narration.provider ?? null,
            status: "completed",
            audioMetrics: narration.audioMetrics,
            metadata: { source: "scene-player", voiceId: narration.voiceId },
          });
          if (!runningRef.current || generation !== loopGenerationRef.current) return;
          applyDecision(decision, "narrator");
          return tick(generation);
        }

        if (decision.action === "speak") {
          const speakerRequest = buildSpeakerTurnRequest({
            scene,
            sceneState: sceneStateRef.current,
            decision,
            recentTurns: turnsRef.current,
          });
          if (!speakerRequest) {
            applyDecision(decision, null);
            return tick(generation);
          }

          setCurrentSpeakerSlug(speakerRequest.characterSlug);
          setPhase("speaking");
          const voiceResult = await streamCharacterVoice({
            bus,
            sessionId,
            turnId: generateTurnId(),
            speakerRequest,
            voiceStreamAbortRef,
          });
          pushTrace(voiceResult.trace);

          if (!runningRef.current || generation !== loopGenerationRef.current) return;

          pushTurn({
            speakerSlug: speakerRequest.characterSlug,
            speakerName: speakerRequest.speakerName,
            text: voiceResult.text,
          });
          applyDecision(decision, speakerRequest.characterSlug);
          return tick(generation);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[scene-runner] tick failed", message);
        if (generation === loopGenerationRef.current) {
          setError(message);
          setPhase("error");
          runningRef.current = false;
        }
      }
    },
    [sessionId, scene, applyDecision, pushTurn, pushTrace, ensureBus, generateTurnId],
  );

  const start = useCallback(async () => {
    setError(null);
    const bus = ensureBus(); // satisfies user-gesture rule
    bus.setAmbience(sceneStateRef.current.ambience);
    runningRef.current = true;
    loopGenerationRef.current += 1;
    const generation = loopGenerationRef.current;
    await tick(generation);
  }, [ensureBus, tick]);

  const sendUserMessage = useCallback(
    async (text: string, options?: { turnId?: string }) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Barge-in: kill any in-flight character audio and the underlying
      // voice-stream fetch, then push the user's turn and re-enter the
      // loop. Bumping the generation invalidates any in-flight tick.
      voiceStreamAbortRef.current?.abort();
      busRef.current?.stopVoice();
      loopGenerationRef.current += 1;
      const generation = loopGenerationRef.current;
      const turnId = options?.turnId ?? generateTurnId();
      runningRef.current = true;
      ensureBus();

      pushTurn({ id: turnId, speakerSlug: "user", speakerName: "You", text: trimmed });
      void persistSceneTurn({
        sessionId,
        turnId,
        inputMode: "text",
        speakerSlug: "user",
        userText: trimmed,
        status: "completed",
        metadata: { source: "scene-player" },
      });
      await tick(generation, trimmed);
    },
    [ensureBus, generateTurnId, pushTurn, sessionId, tick],
  );

  const stop = useCallback(() => {
    runningRef.current = false;
    loopGenerationRef.current += 1;
    voiceStreamAbortRef.current?.abort();
    busRef.current?.stopVoice();
    busRef.current?.setAmbience(null);
    setPhase("idle");
    setCurrentSpeakerSlug(null);
  }, []);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      voiceStreamAbortRef.current?.abort();
      busRef.current?.stopVoice();
      busRef.current?.setAmbience(null);
    };
  }, []);

  return {
    phase,
    sceneState,
    turns,
    traces,
    latestTrace: traces[traces.length - 1] ?? null,
    currentSpeakerSlug,
    error,
    start,
    sendUserMessage,
    stop,
  };
}

/* ── Orchestrate API ────────────────────────────────────────────────── */

type OrchestratorApiResult = {
  decision: OrchestratorDecision;
  sceneState?: SceneState;
  sceneMemory?: string[];
  orchestrator?: { provider: string; model: string };
  degraded?: boolean;
  reason?: string;
  trace: TraceContract;
};

type VoiceStreamDonePayload = {
  inputTokens?: number;
  outputTokens?: number;
  audioSamples?: number;
  firstAudioMs?: number;
  totalMs?: number;
  provider?: string;
  model?: string;
  serverTrace?: TracePayload;
};

async function fetchOrchestratorDecision(input: {
  sessionId: string;
  sceneId: string;
  sceneState: SceneState;
  recentTurns: Array<{ speakerSlug: string; speakerName?: string; text: string }>;
  lastUserMessage?: string;
}): Promise<OrchestratorApiResult> {
  const resp = await fetch(
    `/api/scene-sessions/${encodeURIComponent(input.sessionId)}/orchestrate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sceneId: input.sceneId,
        sceneState: input.sceneState,
        recentTurns: input.recentTurns,
        lastUserMessage: input.lastUserMessage,
      }),
    },
  );
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`orchestrate ${resp.status}: ${detail.slice(0, 200)}`);
  }
  const payload = (await resp.json()) as {
    decision: OrchestratorDecision;
    sceneState?: SceneState;
    sceneMemory?: string[];
    orchestrator?: { provider: string; model: string };
    degraded?: boolean;
    reason?: string;
    trace?: TraceContract;
  };
  if (payload.degraded) {
    console.warn("[scene-runner] orchestrator degraded:", payload.reason);
  }
  return {
    ...payload,
    trace: payload.trace ?? {
      startedAt: new Date().toISOString(),
      elapsedMs: 0,
      events: [],
    },
  };
}

/* ── Voice-stream consumer ─────────────────────────────────────────── */

async function streamCharacterVoice(args: {
  bus: SceneAudioBus;
  sessionId: string;
  turnId: string;
  speakerRequest: SpeakerTurnRequest;
  voiceStreamAbortRef: React.MutableRefObject<AbortController | null>;
}): Promise<{ text: string; trace: SceneRunnerTrace | null }> {
  const controller = new AbortController();
  args.voiceStreamAbortRef.current = controller;

  const resp = await fetch(
    `/api/characters/${encodeURIComponent(args.speakerRequest.characterSlug)}/voice-stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: args.sessionId,
        turnId: args.turnId,
        message: args.speakerRequest.message,
        history: args.speakerRequest.history,
        promptChunk: args.speakerRequest.promptChunk,
        voice: args.speakerRequest.voiceSlug,
      }),
      signal: controller.signal,
    },
  );
  if (!resp.ok || !resp.body) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`voice-stream ${resp.status}: ${detail.slice(0, 200)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let replyText = "";
  let latestServerTrace: TracePayload | null = null;
  let donePayload: VoiceStreamDonePayload | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let frameEnd: number;
    while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      let eventName: string | null = null;
      let dataLine = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataLine += line.slice(6);
      }
      if (!eventName || !dataLine) continue;

      if (eventName === "trace") {
        latestServerTrace = JSON.parse(dataLine) as TracePayload;
      } else if (eventName === "token") {
        const payload = JSON.parse(dataLine) as { delta?: string };
        if (payload.delta) replyText += payload.delta;
      } else if (eventName === "audio") {
        const payload = JSON.parse(dataLine) as {
          pcm: string;
          sampleRate: number;
        };
        const samples = SceneAudioBus.decodeFloat32Base64(payload.pcm);
        args.bus.enqueueVoiceFrame(samples, payload.sampleRate);
      } else if (eventName === "done") {
        donePayload = JSON.parse(dataLine) as VoiceStreamDonePayload;
        if (donePayload?.serverTrace) latestServerTrace = donePayload.serverTrace;
      } else if (eventName === "error") {
        const payload = JSON.parse(dataLine) as { message?: string };
        throw new Error(`voice-stream error: ${payload.message ?? "unknown"}`);
      }
    }
  }

  // Wait for the audio bus to fully drain before resolving so the next
  // tick doesn't overlap with this speaker's tail.
  await args.bus.voiceDrained();
  if (args.voiceStreamAbortRef.current === controller) {
    args.voiceStreamAbortRef.current = null;
  }
  return {
    text: replyText.trim(),
    trace: latestServerTrace
      ? {
          id: args.turnId,
          kind: "voice",
          at: new Date().toISOString(),
          trace: latestServerTrace,
          meta: {
            sessionId: args.sessionId,
            turnId: args.turnId,
            speakerSlug: args.speakerRequest.characterSlug,
            provider: donePayload?.provider ?? null,
            model: donePayload?.model ?? null,
            firstAudioMs: donePayload?.firstAudioMs ?? null,
            totalMs: donePayload?.totalMs ?? null,
          },
        }
      : null,
  };
}

/* ── Narrator ──────────────────────────────────────────────────────── */

async function playNarration(
  bus: SceneAudioBus,
  text: string,
  voiceId: string,
): Promise<{
  provider: string | null;
  voiceId: string;
  audioMetrics: Record<string, unknown>;
}> {
  // Narration routes through /api/scenes/narrate, which resolves a library
  // voice id through the SAME streaming TTS pipeline characters use (PCM
  // frames played via the SceneAudioBus voice track), or falls back to batch
  // OpenAI TTS (mp3) for bare voice names / unconfigured voices.
  const resp = await fetch("/api/scenes/narrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`narrator ${resp.status}: ${detail.slice(0, 200)}`);
  }
  const payload = (await resp.json()) as
    | {
        kind: "pcm";
        provider?: string;
        frames: Array<{ pcm: string; sampleRate: number }>;
      }
    | {
        kind: "mp3";
        provider?: string;
        audioBase64?: string;
        mimeType?: string;
      };

  if (payload.kind === "pcm") {
    // Same playback path as character voice — feed frames into the bus's
    // voice track and wait for it to drain before the loop advances.
    for (const frame of payload.frames) {
      bus.enqueueVoiceFrame(SceneAudioBus.decodeFloat32Base64(frame.pcm), frame.sampleRate);
    }
    await bus.voiceDrained();
    const sampleRate = payload.frames[0]?.sampleRate ?? null;
    const audioSamples = payload.frames.reduce(
      (sum, frame) => sum + SceneAudioBus.decodeFloat32Base64(frame.pcm).length,
      0,
    );
    return {
      provider: payload.provider ?? null,
      voiceId,
      audioMetrics: {
        kind: "pcm",
        sampleRate,
        audioSamples,
        durationMs:
          sampleRate && audioSamples
            ? Math.round((audioSamples / sampleRate) * 1000)
            : null,
        frameCount: payload.frames.length,
      },
    };
  }

  if (!payload.audioBase64) {
    throw new Error("narrator returned no audio");
  }
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(`data:${payload.mimeType ?? "audio/mpeg"};base64,${payload.audioBase64}`);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("narrator audio playback failed"));
    audio.play().catch(reject);
  });
  return {
    provider: payload.provider ?? "openai",
    voiceId,
    audioMetrics: {
      kind: "mp3",
      mimeType: payload.mimeType ?? "audio/mpeg",
      byteSize: payload.audioBase64.length,
    },
  };
}

async function persistSceneTurn(input: {
  sessionId: string;
  turnId: string;
  inputMode: string;
  speakerSlug: string;
  userText?: string | null;
  assistantText?: string | null;
  provider?: string | null;
  model?: string | null;
  status: string;
  tokenUsage?: unknown;
  audioMetrics?: unknown;
  latencySummary?: unknown;
  trace?: unknown;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await fetch(
    `/api/scene-sessions/${encodeURIComponent(input.sessionId)}/turns/${encodeURIComponent(input.turnId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputMode: input.inputMode,
        speakerSlug: input.speakerSlug,
        userText: input.userText ?? null,
        assistantText: input.assistantText ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        status: input.status,
        completedAt: new Date().toISOString(),
        tokenUsage: input.tokenUsage ?? {},
        audioMetrics: input.audioMetrics ?? {},
        latencySummary: input.latencySummary ?? {},
        trace: input.trace ?? {},
        metadata: input.metadata ?? {},
      }),
    },
  ).catch((err) => {
    console.warn("[scene-player] turn persistence failed", err);
  });
}
