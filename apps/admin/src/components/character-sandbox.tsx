"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { modelMetaFor, type ModelOption } from "@/lib/model-registry";
import type { OrchestratorDecision, SceneState } from "@odyssey/types";
import { useHeaderContent } from "@/components/header-context";
import { Pathname } from "@/components/pathname";
import {
  PcmPlayer,
  blobToBase64,
  captureMic,
  prepareSandboxVoiceTurn,
  streamChat,
  streamVoice,
  transcribeAudio,
  warmSandboxVoiceContext,
  type ChatHistoryTurn,
} from "@/lib/sandbox-streams";
import { AudioRtStreamingSttSession } from "@/lib/audio-rt-streaming-stt";
import type { TracePayload } from "@/lib/voice-trace";
import type {
  SandboxBinding,
  SandboxCharacter,
} from "@/app/(authenticated)/characters/[slug]/sandbox/page";
import { SandboxVoiceStage } from "./character-sandbox/sandbox-voice-stage";
import { SandboxChatStage } from "./character-sandbox/sandbox-chat-stage";
import { SandboxConfigSidebar } from "./character-sandbox/sandbox-config-sidebar";
import { SandboxMissionControl } from "./character-sandbox/sandbox-mission-control";
import { SandboxPreSession } from "./character-sandbox/sandbox-pre-session";
import { SandboxTraceDrawer } from "./character-sandbox/sandbox-trace-drawer";

/**
 * CharacterSandbox — the V1 HUD Console implementation. Voice (default) ↔
 * chat modes, with two independently dismissible panels:
 *   - Right sidebar: live config snapshot (Identity / Voice / Mind /
 *     Knowledge / Limits)
 *   - Bottom pane: mission control (telemetry stats grid + terminal log)
 *
 * Both panel toggles live in the top toolbar, right-most. The center stage
 * stays anchored regardless of which panels are open.
 *
 * Voice/chat conversation wiring is stubbed for now (mock turns + a no-op
 * mic handler) — the real STT/TTS/LLM stream plugs in via the
 * `onSendMessage` / `onMicToggle` callbacks once the runtime route is
 * ready.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const DANGER = "var(--danger)";
const CHARACTER_SANDBOX_SCENE_PREFIX = "character-sandbox:";

export type SandboxMode = "voice" | "chat";
export type SandboxPhase = "pre-session" | "live" | "post-session";

export type SandboxTurn = {
  id: string;
  speaker: "user" | "character";
  text: string;
  /** Relative timestamp from session start, ms. */
  timestampMs: number;
  /** TTFT for character turns, ms. */
  ttftMs?: number;
  /** Token count for this turn. */
  tokens?: number;
  /** Number of wiki facts recalled (character turns only). */
  factsRecalled?: number;
  provider?: string | null;
  model?: string | null;
  estimatedCostUsd?: number;
  trace?: TracePayload;
  /** True while the turn is being authored / captured. */
  inFlight?: boolean;
};

export type SandboxTraceRecord = {
  id: string;
  turnId?: string;
  kind: "voice" | "chat" | "session";
  at: string;
  trace: TracePayload;
  meta: {
    provider?: string | null;
    model?: string | null;
    firstAudioMs?: number | null;
    totalMs?: number | null;
  };
};

type Props = {
  character: SandboxCharacter;
  bindings: SandboxBinding[];
  defaultModel: ModelOption["id"];
};

type EndedSandboxSession = {
  id: string;
  mode: SandboxMode;
  endedAt: number;
  durationMs: number;
  turnCount: number;
  characterTurnCount: number;
  traceCount: number;
  tokens: number;
  spent: number;
  ttftMs: number | null;
  status: "ending" | "ended";
  error?: string | null;
};

export function CharacterSandbox({ character, bindings, defaultModel }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<SandboxMode>("voice");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [traceOpen, setTraceOpen] = useState(true);

  // Session lifecycle. The page lands in the pre-session manifest, advances
  // into a persisted live session, then lands in a post-session review before
  // the author starts another run.
  const [phase, setPhase] = useState<SandboxPhase>("pre-session");
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [worldSessionId, setWorldSessionId] = useState<string | null>(null);
  const worldSessionIdRef = useRef<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [endedSession, setEndedSession] = useState<EndedSandboxSession | null>(null);

  const [turns, setTurns] = useState<SandboxTurn[]>([]);
  const [traceRecords, setTraceRecords] = useState<SandboxTraceRecord[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [micOn, setMicOn] = useState(false);

  // Streaming machinery — abort controller for the in-flight LLM call,
  // PcmPlayer for serial audio playback (voice mode), MediaRecorder
  // refs for push-to-talk mic capture, and a `voiceState` for the
  // wavefield state pill.
  const abortRef = useRef<AbortController | null>(null);
  const pcmPlayerRef = useRef<PcmPlayer | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef<string>("");
  const recorderStartedAtRef = useRef<number | null>(null);
  const voiceContextWarmRef = useRef<Promise<unknown> | null>(null);
  const streamingSttRef = useRef<AudioRtStreamingSttSession | null>(null);
  const streamingTranscriptRef = useRef("");
  const streamingTurnIdRef = useRef<string | null>(null);
  const lastPrepareRef = useRef<{ transcript: string; at: number } | null>(null);
  const [voiceState, setVoiceState] = useState<
    "idle" | "listening" | "thinking" | "speaking"
  >("idle");

  const activeModel = character.brainModel?.model ?? defaultModel;
  const activeVoiceModel =
    character.brainModel?.voice?.model ?? character.brainModel?.model ?? activeModel;
  const totals = useMemo(() => computeTotals(turns), [turns]);
  const lastTurn = turns[turns.length - 1] ?? null;

  async function handleStart() {
    setStartedAt(Date.now());
    setTurns([]);
    setTraceRecords([]);
    setComposerValue("");
    setSessionError(null);
    setEndedSession(null);
    const sessionId = await createSandboxWorldSession({
      characterId: character.id,
      characterSlug: character.slug,
      mode,
      activeModel,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setSessionError(message);
      console.warn("[sandbox] world session create failed; launch blocked", err);
      return null;
    });
    if (!sessionId) {
      worldSessionIdRef.current = null;
      setWorldSessionId(null);
      return;
    }
    worldSessionIdRef.current = sessionId;
    setWorldSessionId(sessionId);
    setPhase("live");
    if (mode === "voice") {
      voiceContextWarmRef.current = warmSandboxVoiceContext({
        characterId: character.id,
        sessionId,
      }).then((context) => {
        setTraceRecords((prev) => [
          ...prev.slice(-49),
          {
            id: `voice-context-${Date.now()}`,
            kind: "session",
            at: new Date().toISOString(),
            trace: {
              startedAt: new Date().toISOString(),
              elapsedMs: context.elapsedMs,
              events: [
                {
                  name: "sandbox.voice_context.warmed",
                  elapsedMs: context.elapsedMs,
                  meta: {
                    tokensUsed: context.tokensUsed,
                    pageSlugs: context.pageSlugs,
                    cacheKey: context.cacheKey,
                    cacheScope: context.cacheScope,
                  },
                },
              ],
            } as unknown as TracePayload,
            meta: {
              model: activeVoiceModel,
            },
          },
        ]);
        return context;
      }).catch((err) => {
        console.warn("[sandbox] voice context warm failed", err);
        return null;
      });
    } else {
      voiceContextWarmRef.current = null;
    }
  }

  function handleEnd() {
    // End the persisted run and retain the local transcript/telemetry for the
    // post-session review surface.
    abortRef.current?.abort();
    pcmPlayerRef.current?.stop();
    stopRecorder();
    stopStreamingStt();
    voiceContextWarmRef.current = null;
    streamingTurnIdRef.current = null;
    lastPrepareRef.current = null;
    setVoiceState("idle");
    setMicOn(false);
    const sessionId = worldSessionIdRef.current;
    worldSessionIdRef.current = null;
    if (!sessionId) {
      setWorldSessionId(null);
      setPhase("pre-session");
      return;
    }
    const durationMs = Math.max(0, Date.now() - startedAt);
    const currentTotals = computeTotals(turns);
    const summary: EndedSandboxSession = {
      id: sessionId,
      mode,
      endedAt: Date.now(),
      durationMs,
      turnCount: turns.length,
      characterTurnCount: turns.filter((turn) => turn.speaker === "character").length,
      traceCount: traceRecords.length,
      tokens: currentTotals.tokens,
      spent: currentTotals.spent,
      ttftMs: lastTurn?.ttftMs ?? null,
      status: "ending",
      error: null,
    };
    setEndedSession(summary);
    setWorldSessionId(sessionId);
    setPhase("post-session");
    if (sessionId) {
      void endSandboxWorldSession(sessionId, {
        turns: turns.length,
        traces: traceRecords.length,
        durationMs,
      }).then(() => {
        setEndedSession((current) =>
          current?.id === sessionId ? { ...current, status: "ended", error: null } : current,
        );
      }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setEndedSession((current) =>
          current?.id === sessionId
            ? { ...current, status: "ended", error: message }
            : current,
        );
      });
    }
  }

  function handleCancel() {
    router.push(`/characters/${character.slug}`);
  }

  function handlePrepareNextSession() {
    abortRef.current?.abort();
    pcmPlayerRef.current?.stop();
    stopRecorder();
    stopStreamingStt();
    voiceContextWarmRef.current = null;
    streamingTurnIdRef.current = null;
    lastPrepareRef.current = null;
    worldSessionIdRef.current = null;
    setWorldSessionId(null);
    setEndedSession(null);
    setSessionError(null);
    setStartedAt(Date.now());
    setTurns([]);
    setTraceRecords([]);
    setComposerValue("");
    setVoiceState("idle");
    setMicOn(false);
    setPhase("pre-session");
  }

  function handleReset() {
    abortRef.current?.abort();
    pcmPlayerRef.current?.stop();
    stopRecorder();
    stopStreamingStt();
    voiceContextWarmRef.current = null;
    streamingTurnIdRef.current = null;
    lastPrepareRef.current = null;
    setStartedAt(Date.now());
    setTurns([]);
    setTraceRecords([]);
    setComposerValue("");
    setVoiceState("idle");
    setMicOn(false);
  }

  /* ── Chat-mode send ────────────────────────────────────────── */

  const sendUtterance = useCallback(
    async (
      text: string,
      viaVoice: boolean,
      audioInput?: { blob: Blob; mimeType: string; durationMs: number | null },
      options?: { turnId?: string },
    ): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const now = Date.now();
      const userTurnId = `you-${now}`;
      const characterTurnId = options?.turnId ?? `chr-${now}`;
      const sessionId = worldSessionIdRef.current;
      const sceneId = buildSandboxSceneId(character.slug);
      let replyText = "";
      const userTurn: SandboxTurn = {
        id: userTurnId,
        speaker: "user",
        text: trimmed,
        timestampMs: now - startedAt,
        tokens: Math.ceil(trimmed.length / 4),
      };
      const characterTurn: SandboxTurn = {
        id: characterTurnId,
        speaker: "character",
        text: "",
        timestampMs: now - startedAt,
        inFlight: true,
        tokens: 0,
        factsRecalled: 0,
      };
      const history: ChatHistoryTurn[] = collectHistory(turns);
      setTurns((prev) => [...prev, userTurn, characterTurn]);
      if (sessionId && audioInput?.blob.size) {
        void uploadSandboxAudioArtifact({
          sessionId,
          turnId: characterTurnId,
          direction: "input",
          blob: audioInput.blob,
          filename: `input-${characterTurnId}.${extensionForMime(audioInput.mimeType)}`,
          durationMs: audioInput.durationMs,
        });
      }
      const sentAt = performance.now();

      const controller = new AbortController();
      abortRef.current = controller;
      setVoiceState("thinking");

      const finalize = (
        update: (turn: SandboxTurn) => SandboxTurn,
      ) => {
        setTurns((prev) =>
          prev.map((t) => (t.id === characterTurnId ? update(t) : t)),
        );
      };

      try {
        const orchestration = sessionId
          ? await fetchSandboxOrchestratorDecision({
              sessionId,
              sceneId,
              character,
              turns: [...turns, userTurn],
              lastUserMessage: trimmed,
            }).catch((err) => {
              console.warn("[sandbox] orchestrator failed; using direct character stream", err);
              return null;
            })
          : null;
        const orchestratorTrace = orchestration?.trace;
        if (orchestratorTrace) {
          const decision = orchestration.decision;
          setTraceRecords((prev) => [
            ...prev.slice(-49),
            {
              id: `orchestrator-${characterTurnId}`,
              turnId: characterTurnId,
              kind: "session",
              at: new Date().toISOString(),
              trace: orchestratorTrace,
              meta: {
                provider: orchestration.orchestrator?.provider ?? null,
                model: orchestration.orchestrator?.model ?? null,
              },
            },
          ]);
          finalize((t) => ({
            ...t,
            trace: t.trace ?? orchestratorTrace,
          }));
          if (orchestration.degraded) {
            console.warn("[sandbox] orchestrator degraded:", orchestration.reason);
          } else if (decision.action === "narrate" && decision.narration?.trim()) {
            finalize((t) => ({
              ...t,
              inFlight: false,
              text: decision.narration!.trim(),
              tokens: Math.ceil(decision.narration!.length / 4),
              provider: orchestration.orchestrator?.provider ?? t.provider ?? null,
              model: orchestration.orchestrator?.model ?? t.model ?? null,
            }));
            setVoiceState("idle");
            return;
          } else if (decision.action === "end-scene") {
            finalize((t) => ({
              ...t,
              inFlight: false,
              text: "[scene ended by orchestrator]",
              provider: orchestration.orchestrator?.provider ?? t.provider ?? null,
              model: orchestration.orchestrator?.model ?? t.model ?? null,
            }));
            setVoiceState("idle");
            return;
          }
        }

        const decision =
          orchestration && !orchestration.degraded
            ? orchestration.decision
            : null;
        const promptChunk = buildSandboxPromptChunk(decision);
        const executionScene = buildSandboxExecutionScene(character, decision);

        if (viaVoice) {
          // Lazy-init the audio queue — Web Audio APIs need a user
          // gesture, which we already have from the mic capture press.
          if (!pcmPlayerRef.current) pcmPlayerRef.current = new PcmPlayer();
          if (voiceContextWarmRef.current) {
            await Promise.race([
              voiceContextWarmRef.current,
              new Promise((resolve) => window.setTimeout(resolve, 150)),
            ]);
          }
          let firstAudioAt: number | null = null;
          const outputFrames: Array<{ pcmBase64: string; samples: number; sampleRate: number }> = [];
          await streamVoice({
            characterId: character.id,
            sessionId,
            turnId: characterTurnId,
            promptChunk,
            message: trimmed,
            history,
            scene: executionScene,
            model: activeVoiceModel,
            signal: controller.signal,
            callbacks: {
              onTrace: (trace) => {
                const record: SandboxTraceRecord = {
                  id: `trace-${characterTurnId}`,
                  turnId: characterTurnId,
                  kind: "voice",
                  at: new Date().toISOString(),
                  trace: trace as TracePayload,
                  meta: {
                    model: activeVoiceModel,
                  },
                };
                setTraceRecords((prev) => [...prev.slice(-49), record]);
                finalize((t) => ({ ...t, trace: trace as TracePayload }));
              },
              onToken: (delta) => {
                replyText += delta;
                finalize((t) => ({
                  ...t,
                  text: t.text + delta,
                }));
              },
              onFirstAudio: (latencyMs) => {
                firstAudioAt = performance.now();
                setVoiceState("speaking");
                finalize((t) => ({
                  ...t,
                  ttftMs: t.ttftMs ?? latencyMs,
                }));
              },
              onAudio: (pcm, samples, rate) => {
                outputFrames.push({ pcmBase64: pcm, samples, sampleRate: rate });
                pcmPlayerRef.current?.enqueue(pcm, samples, rate);
              },
              onDone: (totals) => {
                const done = totals as {
                  inputTokens?: number;
                  outputTokens?: number;
                  provider?: string;
                  model?: string;
                  firstAudioMs?: number;
                  totalMs?: number;
                  serverTrace?: TracePayload;
                  estimatedCostUsd?: number;
                };
                const ttft = firstAudioAt
                  ? Math.round(firstAudioAt - sentAt)
                  : Math.round(performance.now() - sentAt);
                if (done.serverTrace) {
                  setTraceRecords((prev) => [
                    ...prev.slice(-49),
                    {
                      id: `done-${characterTurnId}`,
                      turnId: characterTurnId,
                      kind: "voice",
                      at: new Date().toISOString(),
                      trace: done.serverTrace!,
                      meta: {
                        provider: done.provider ?? null,
                        model: done.model ?? null,
                        firstAudioMs: done.firstAudioMs ?? null,
                        totalMs: done.totalMs ?? null,
                      },
                    },
                  ]);
                }
                if (sessionId && outputFrames.length > 0) {
                  const output = buildWavBlob(outputFrames);
                  if (output) {
                    void uploadSandboxAudioArtifact({
                      sessionId,
                      turnId: characterTurnId,
                      direction: "output",
                      blob: output.blob,
                      filename: `output-${characterTurnId}.wav`,
                      durationMs: output.durationMs,
                      sampleRate: output.sampleRate,
                    });
                  }
                }
                finalize((t) => ({
                  ...t,
                  inFlight: false,
                  ttftMs: t.ttftMs ?? ttft,
                  tokens:
                    typeof done.inputTokens === "number" || typeof done.outputTokens === "number"
                      ? (done.inputTokens ?? 0) + (done.outputTokens ?? 0)
                      : Math.ceil(t.text.length / 4),
                  provider: done.provider ?? t.provider ?? null,
                  model: done.model ?? t.model ?? null,
                  estimatedCostUsd: done.estimatedCostUsd ?? t.estimatedCostUsd,
                  trace: done.serverTrace ?? t.trace,
                }));
                setVoiceState(micOn ? "listening" : "idle");
              },
              onError: (msg) => {
                finalize((t) => ({
                  ...t,
                  inFlight: false,
                  text: t.text || `[error: ${msg}]`,
                }));
                setVoiceState("idle");
              },
            },
          });
        } else {
          await streamChat({
            characterId: character.id,
            sessionId,
            turnId: characterTurnId,
            message: trimmed,
            history,
            scene: executionScene,
            model: activeModel,
            signal: controller.signal,
            callbacks: {
              onCurator: (cur) => {
                const trace = cur.timingTrace ?? cur.trace;
                if (trace) {
                  const record: SandboxTraceRecord = {
                    id: `trace-${characterTurnId}`,
                    turnId: characterTurnId,
                    kind: "chat",
                    at: new Date().toISOString(),
                    trace: trace as TracePayload,
                    meta: {
                      model: activeModel,
                    },
                  };
                  setTraceRecords((prev) => [...prev.slice(-49), record]);
                  finalize((t) => ({ ...t, trace: trace as TracePayload }));
                }
                finalize((t) => ({
                  ...t,
                  factsRecalled: cur.pages.length,
                }));
              },
              onToken: (delta) => {
                replyText += delta;
                finalize((t) => ({
                  ...t,
                  text: t.text + delta,
                  ttftMs:
                    t.ttftMs ??
                    Math.round(performance.now() - sentAt),
                }));
              },
              onDone: ({ outputTokens, inputTokens, provider, model, estimatedCostUsd }) => {
                const resolvedProvider =
                  provider ?? modelMetaFor(model ?? activeModel)?.provider ?? null;
                const resolvedModel = model ?? activeModel;
                finalize((t) => ({
                  ...t,
                  inFlight: false,
                  tokens: outputTokens + inputTokens,
                  provider: resolvedProvider,
                  model: resolvedModel,
                  estimatedCostUsd,
                }));
                setVoiceState("idle");
              },
              onError: (msg) => {
                finalize((t) => ({
                  ...t,
                  inFlight: false,
                  text: t.text || `[error: ${msg}]`,
                }));
                setVoiceState("idle");
              },
            },
          });
        }
      } catch (err) {
        // AbortError lands here when the user ends the session mid-stream;
        // the turn is already marked done by handleEnd/handleReset, so just
        // swallow it.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "AbortError" && !msg.includes("abort")) {
          finalize((t) => ({
            ...t,
            inFlight: false,
            text: t.text || `[error: ${msg}]`,
          }));
        }
      } finally {
        abortRef.current = null;
      }
    },
    [character, turns, startedAt, activeModel, activeVoiceModel, micOn],
  );

  function handleSendText() {
    void sendUtterance(composerValue, false);
    setComposerValue("");
  }

  /* ── Save turn as example ─────────────────────────────────── */

  // `saved` snapshots which character-turn ids have been promoted so the
  // "+ save" buttons can disable + flip to "✓ saved" inline without
  // round-tripping the entire directive back from the API.
  const [savedTurnIds, setSavedTurnIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Keep a live copy of the directive so multiple consecutive saves
  // accumulate exemplars instead of clobbering each other.
  const directiveRef = useRef(character.directive);
  useEffect(() => {
    directiveRef.current = character.directive;
  }, [character.directive]);

  const handleSaveExample = useCallback(
    async (characterTurnId: string) => {
      const turn = turns.find((t) => t.id === characterTurnId);
      if (!turn || turn.speaker !== "character" || turn.inFlight) return;
      const idx = turns.findIndex((t) => t.id === characterTurnId);
      const userTurn = [...turns.slice(0, idx)]
        .reverse()
        .find((t) => t.speaker === "user");
      if (!userTurn) return;

      const current = directiveRef.current ?? {};
      const existing = current.exemplars ?? [];
      if (existing.length >= 8) {
        // Cap matches the server's `max(8)` — surface as an inline
        // system message so the user knows why save is a no-op.
        setTurns((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            speaker: "character",
            text: "[example cap reached · drop one in the editor first]",
            timestampMs: Date.now() - startedAt,
          },
        ]);
        return;
      }
      const nextDirective = {
        ...current,
        exemplars: [
          ...existing,
          {
            user: userTurn.text.trim(),
            you: turn.text.trim(),
          },
        ],
      };
      // Optimistic: mark saved immediately so the chip flips. Rollback
      // on API error.
      setSavedTurnIds((prev) => {
        const next = new Set(prev);
        next.add(characterTurnId);
        return next;
      });
      try {
        const res = await fetch(
          `/api/characters/${character.id}/directive`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ directive: nextDirective }),
          },
        );
        if (!res.ok) throw new Error(`${res.status}`);
        directiveRef.current = nextDirective;
      } catch {
        setSavedTurnIds((prev) => {
          const next = new Set(prev);
          next.delete(characterTurnId);
          return next;
        });
      }
    },
    [turns, character.id, startedAt],
  );

  /* ── Voice-mode mic capture ────────────────────────────────── */

  function stopRecorder() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    recorderStreamRef.current = null;
    recorderChunksRef.current = [];
    recorderStartedAtRef.current = null;
  }

  function stopStreamingStt() {
    const session = streamingSttRef.current;
    streamingSttRef.current = null;
    if (session) {
      void session.stop().catch((err) => {
        console.warn("[sandbox] streaming STT stop failed", err);
      });
    }
  }

  function prepareVoiceContextFromPartial(partialTranscript: string) {
    const partial = partialTranscript.trim();
    if (partial.length < 8) return;
    const now = performance.now();
    const last = lastPrepareRef.current;
    if (
      last &&
      (partial === last.transcript || now - last.at < 350)
    ) {
      return;
    }
    lastPrepareRef.current = { transcript: partial, at: now };
    void prepareSandboxVoiceTurn({
      characterId: character.id,
      sessionId: worldSessionIdRef.current,
      turnId: streamingTurnIdRef.current,
      partialTranscript: partial,
      startedAtMs: recorderStartedAtRef.current ?? undefined,
    }).catch((err) => {
      console.warn("[sandbox] voice context prepare failed", err);
    });
  }

  const handleMicToggle = useCallback(async () => {
    if (micOn) {
      // Releasing the mic: stop the recorder, send the captured blob to
      // STT, then fire the voice-stream once we have a transcript.
      const rec = recorderRef.current;
      const mimeType = recorderMimeRef.current || "audio/webm";
      setMicOn(false);
      setVoiceState("thinking");
      if (!rec) {
        streamingTurnIdRef.current = null;
        lastPrepareRef.current = null;
        return;
      }
      const finished = new Promise<Blob>((resolve) => {
        rec.addEventListener(
          "stop",
          () => {
            const blob = new Blob(recorderChunksRef.current, {
              type: mimeType,
            });
            resolve(blob);
          },
          { once: true },
        );
      });
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      const blob = await finished;
      const durationMs =
        recorderStartedAtRef.current !== null
          ? Math.max(0, Math.round(performance.now() - recorderStartedAtRef.current))
          : null;
      const streamingTranscript = streamingTranscriptRef.current.trim();
      const preparedTurnId = streamingTurnIdRef.current ?? `chr-${crypto.randomUUID()}`;
      streamingTurnIdRef.current = preparedTurnId;
      stopStreamingStt();
      stopRecorder();
      if (blob.size === 0) {
        streamingTurnIdRef.current = null;
        lastPrepareRef.current = null;
        setVoiceState("idle");
        return;
      }
      try {
        let transcript = streamingTranscript;
        if (!transcript) {
          const audioBase64 = await blobToBase64(blob);
          const result = await transcribeAudio(audioBase64, mimeType);
          transcript = result.transcript;
        }
        if (!transcript.trim()) {
          setVoiceState("idle");
          return;
        }
        prepareVoiceContextFromPartial(transcript);
        await sendUtterance(
          transcript,
          true,
          {
            blob,
            mimeType,
            durationMs,
          },
          {
            turnId: preparedTurnId,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Surface as an in-line "system" turn so the user sees what
        // happened without leaving the sandbox.
        setTurns((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            speaker: "character",
            text: `[transcribe error: ${msg}]`,
            timestampMs: Date.now() - startedAt,
          },
        ]);
        setVoiceState("idle");
      } finally {
        if (streamingTurnIdRef.current === preparedTurnId) {
          streamingTurnIdRef.current = null;
        }
        lastPrepareRef.current = null;
      }
      return;
    }

    // Arming the mic: request the stream, start the recorder, buffer
    // chunks until stop.
    try {
      const { recorder, stream, mimeType } = await captureMic();
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      recorderMimeRef.current = mimeType || "audio/webm";
      recorderChunksRef.current = [];
      recorder.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size > 0) {
          recorderChunksRef.current.push(e.data);
        }
      });
      recorder.start(250);
      recorderStartedAtRef.current = performance.now();
      streamingTranscriptRef.current = "";
      streamingTurnIdRef.current = `chr-${crypto.randomUUID()}`;
      lastPrepareRef.current = null;
      const streamingSession = new AudioRtStreamingSttSession();
      streamingSttRef.current = streamingSession;
      void streamingSession.start(
        stream,
        {
          onWord: (word) => {
            const next = [streamingTranscriptRef.current, word]
              .filter(Boolean)
              .join(" ")
              .trim();
            streamingTranscriptRef.current = next;
            prepareVoiceContextFromPartial(next);
          },
          onError: (message) => {
            console.warn("[sandbox] streaming STT error", message);
          },
          onClose: () => {
            if (streamingSttRef.current === streamingSession) {
              streamingSttRef.current = null;
            }
          },
        },
      ).catch((err) => {
        console.warn("[sandbox] streaming STT start failed; blob STT fallback remains active", err);
        if (streamingSttRef.current === streamingSession) {
          streamingSttRef.current = null;
        }
      });
      setMicOn(true);
      setVoiceState("listening");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          speaker: "character",
          text: `[mic error: ${msg}]`,
          timestampMs: Date.now() - startedAt,
        },
      ]);
      setVoiceState("idle");
      setMicOn(false);
      streamingTurnIdRef.current = null;
      lastPrepareRef.current = null;
    }
  }, [micOn, sendUtterance, startedAt]);

  // Tear down audio + mic on unmount so background sessions don't keep
  // streaming after the user navigates away.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      pcmPlayerRef.current?.stop();
      pcmPlayerRef.current = null;
      stopRecorder();
      stopStreamingStt();
    };
  }, []);

  // Push toolbar into the admin shell's 48px root header so the admin
  // sidebar + brand toggle stay visible on the sandbox route. The header
  // slot is `alignSelf: stretch`, so we get the full 48px to lay out our
  // breadcrumb / mode toggle / actions.
  const { setContent } = useHeaderContent();
  useEffect(() => {
    setContent(
      phase === "live" ? (
        <SandboxHeaderToolbar
          slug={character.slug}
          title={character.title}
          mode={mode}
          onModeChange={setMode}
          bottomOpen={bottomOpen}
          sidebarOpen={sidebarOpen}
          traceOpen={traceOpen}
          onToggleBottom={() => setBottomOpen((v) => !v)}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleTrace={() => setTraceOpen((v) => !v)}
          onReset={handleReset}
          onEnd={handleEnd}
        />
      ) : phase === "post-session" ? (
        <SandboxPostSessionToolbar
          slug={character.slug}
          title={character.title}
          sessionId={endedSession?.id ?? worldSessionId}
          traceOpen={traceOpen}
          traceCount={traceRecords.length}
          onToggleTrace={() => setTraceOpen((v) => !v)}
          onStartNext={handlePrepareNextSession}
        />
      ) : (
        <SandboxPreSessionToolbar
          slug={character.slug}
          title={character.title}
          traceOpen={traceOpen}
          traceCount={traceRecords.length}
          onToggleTrace={() => setTraceOpen((v) => !v)}
        />
      ),
    );
    return () => setContent(null);
    // `handleReset` / `handleEnd` are stable enough across renders that
    // we only re-push when the user-facing state actually changes.
  }, [
    setContent,
    character.slug,
    character.title,
    mode,
    bottomOpen,
    sidebarOpen,
    traceOpen,
    traceRecords.length,
    phase,
    endedSession?.id,
    worldSessionId,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // /characters/* is a flush route — admin-shell drops <main>'s padding to
    // 0 and <main> itself owns the (100vh - header) height via flex:1. We
    // fill that space exactly so the outer <main> never has to scroll.
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--background)",
        color: "var(--text-primary)",
        overflow: "hidden",
      }}
    >
      {phase === "pre-session" ? (
        <SandboxPreSession
          character={character}
          bindings={bindings}
          activeModel={activeModel}
          mode={mode}
          sessionError={sessionError}
          onModeChange={setMode}
          onStart={handleStart}
          onCancel={handleCancel}
        />
      ) : phase === "post-session" && endedSession ? (
        <SandboxPostSession
          character={character}
          summary={endedSession}
          turns={turns}
          traceRecords={traceRecords}
          onStartNext={handlePrepareNextSession}
          onReturnToCharacter={handleCancel}
        />
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <TelemetryStrip
              elapsedSec={Math.floor((Date.now() - startedAt) / 1000)}
              ttftMs={lastTurn?.ttftMs ?? null}
              spent={totals.spent}
              turn={turns.length}
              tokens={totals.tokens}
            />
            {mode === "voice" ? (
              <SandboxVoiceStage
                character={character}
                micOn={micOn}
                onMicToggle={() => void handleMicToggle()}
                lastUserUtterance={
                  [...turns].reverse().find((t) => t.speaker === "user")
                    ?.text ?? null
                }
                state={voiceState}
              />
            ) : (
              <SandboxChatStage
                character={character}
                turns={turns}
                composerValue={composerValue}
                onComposerChange={setComposerValue}
                onSend={handleSendText}
                savedTurnIds={savedTurnIds}
                onSaveExample={handleSaveExample}
              />
            )}
          </div>
          {bottomOpen && (
            <SandboxMissionControl
              turns={turns}
              sessionId={worldSessionId}
              traceCount={traceRecords.length}
              sessionError={sessionError}
              ttftMs={lastTurn?.ttftMs ?? null}
              tokensUsed={totals.tokens}
              spent={totals.spent}
              model={activeModel}
              scopeTags={extractScopeTags(character)}
              lastRecall={lastTurn?.factsRecalled ?? 0}
              onCollapse={() => setBottomOpen(false)}
              savedTurnIds={savedTurnIds}
              onSaveExample={handleSaveExample}
            />
          )}
        </div>
          {sidebarOpen && (
            <SandboxConfigSidebar
              character={character}
              bindings={bindings}
              activeModel={activeModel}
              lastTurn={lastTurn}
              savedTurnIds={savedTurnIds}
              onSaveExample={handleSaveExample}
            />
          )}
        </div>
      )}
      <SandboxTraceDrawer
        open={traceOpen}
        phase={phase}
        mode={mode}
        records={traceRecords}
        characterId={character.id}
        characterTitle={character.title}
        sessionId={worldSessionId}
        sessionError={sessionError}
        chatModel={activeModel}
        voiceModel={activeVoiceModel}
        onClose={() => setTraceOpen(false)}
      />
    </div>
  );
}

/* ── Header toolbar ───────────────────────────────────────────── */

function SandboxPreSessionToolbar({
  slug,
  title,
  traceOpen,
  traceCount,
  onToggleTrace,
}: {
  slug: string;
  title: string;
  traceOpen: boolean;
  traceCount: number;
  onToggleTrace: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
        minWidth: 0,
      }}
    >
      <Pathname
        segments={[
          { label: "characters", href: "/characters" },
          { label: title, href: `/characters/${slug}` },
          {
            label: "sandbox",
            href: `/characters/${slug}/sandbox`,
            tag: true,
          },
        ]}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          ready · pre-session
        </span>
        <HeaderTraceToggle
          active={traceOpen}
          traceCount={traceCount}
          onClick={onToggleTrace}
        />
      </div>
    </div>
  );
}

function SandboxPostSessionToolbar({
  slug,
  title,
  sessionId,
  traceOpen,
  traceCount,
  onToggleTrace,
  onStartNext,
}: {
  slug: string;
  title: string;
  sessionId: string | null;
  traceOpen: boolean;
  traceCount: number;
  onToggleTrace: () => void;
  onStartNext: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
        minWidth: 0,
      }}
    >
      <Pathname
        segments={[
          { label: "characters", href: "/characters" },
          { label: title, href: `/characters/${slug}` },
          {
            label: "post-session",
            href: `/characters/${slug}/sandbox`,
            tag: true,
          },
        ]}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}>
        {sessionId ? (
          <a
            href={`/sessions/${encodeURIComponent(sessionId)}`}
            style={{
              padding: "6px 12px",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            view session
          </a>
        ) : null}
        <button
          type="button"
          onClick={onStartNext}
          style={{
            padding: "6px 12px",
            border: "1px solid var(--accent-border)",
            background: "var(--accent-fill)",
            color: ACCENT,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          new run
        </button>
        <HeaderTraceToggle
          active={traceOpen}
          traceCount={traceCount}
          onClick={onToggleTrace}
        />
      </div>
    </div>
  );
}

function SandboxPostSession({
  character,
  summary,
  turns,
  traceRecords,
  onStartNext,
  onReturnToCharacter,
}: {
  character: SandboxCharacter;
  summary: EndedSandboxSession;
  turns: SandboxTurn[];
  traceRecords: SandboxTraceRecord[];
  onStartNext: () => void;
  onReturnToCharacter: () => void;
}) {
  const recentTurns = turns.slice(-6);
  const firstUserTurn = turns.find((turn) => turn.speaker === "user");
  const lastCharacterTurn = [...turns]
    .reverse()
    .find((turn) => turn.speaker === "character" && turn.text.trim());
  const statusLabel =
    summary.error
      ? "ended · sync warning"
      : summary.status === "ending"
        ? "ending session"
        : "ended";

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 380px",
        background: "var(--background)",
        overflow: "hidden",
      }}
    >
      <section
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "64px",
          gap: "var(--space-32)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)", maxWidth: 880 }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: summary.error ? DANGER : ACCENT,
            }}
          >
            {statusLabel}
          </span>
          <h1
            style={{
              margin: 0,
              fontFamily: FONT_HEAD,
              fontSize: 64,
              fontWeight: 600,
              lineHeight: "68px",
              letterSpacing: "-0.03em",
              color: "var(--text-primary)",
            }}
          >
            {character.title} sandbox session
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 680,
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-xl)",
              lineHeight: "30px",
              color: "var(--text-secondary)",
            }}
          >
            {firstUserTurn
              ? `Started with “${truncateText(firstUserTurn.text, 96)}”.`
              : "No user turns were captured in this run."}
          </p>
          {summary.error ? (
            <div
              role="alert"
              style={{
                maxWidth: 760,
                border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)",
                background: "color-mix(in srgb, var(--danger) 10%, transparent)",
                color: DANGER,
                padding: "12px 14px",
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                lineHeight: "18px",
              }}
            >
              The local review is available, but the final session-ended update failed: {summary.error}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(120px, 1fr))",
            gap: "var(--space-12)",
            maxWidth: 920,
          }}
        >
          <PostMetric label="duration" value={formatDurationMs(summary.durationMs)} />
          <PostMetric label="turns" value={String(summary.characterTurnCount).padStart(2, "0")} hint={`${summary.turnCount} events`} />
          <PostMetric label="ttft" value={summary.ttftMs != null ? `${summary.ttftMs}ms` : "—"} />
          <PostMetric label="tokens" value={summary.tokens.toLocaleString()} hint={formatCost(summary.spent)} />
        </div>

        <div style={{ display: "flex", gap: "var(--space-12)", flexWrap: "wrap" }}>
          <a
            href={`/sessions/${encodeURIComponent(summary.id)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 42,
              padding: "0 18px",
              border: "1px solid var(--accent-border)",
              background: "var(--accent-fill)",
              color: ACCENT,
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            open persisted session
          </a>
          <button
            type="button"
            onClick={onStartNext}
            style={{
              minHeight: 42,
              padding: "0 18px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            configure next run
          </button>
          <button
            type="button"
            onClick={onReturnToCharacter}
            style={{
              minHeight: 42,
              padding: "0 18px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-tertiary)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            return to character
          </button>
        </div>
      </section>

      <aside
        style={{
          minHeight: 0,
          borderLeft: "1px solid var(--border)",
          background: "var(--card)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-8)",
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            session {summary.id.slice(0, 8)}
          </span>
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-2xl)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Local review
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.10em",
              color: "var(--text-tertiary)",
            }}
          >
            {summary.mode} · {traceRecords.length} traces · ended {formatClockTime(summary.endedAt)}
          </span>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-16)",
          }}
        >
          {lastCharacterTurn ? (
            <PostTranscriptBlock
              label="last character reply"
              text={lastCharacterTurn.text}
              accent
            />
          ) : null}
          {recentTurns.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                }}
              >
                recent transcript
              </span>
              {recentTurns.map((turn) => (
                <PostTranscriptBlock
                  key={turn.id}
                  label={turn.speaker === "user" ? "you" : character.title}
                  text={turn.text || (turn.inFlight ? "interrupted" : "")}
                  accent={turn.speaker === "character"}
                />
              ))}
            </div>
          ) : (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-sm)",
                letterSpacing: "0.10em",
                color: "var(--text-tertiary)",
              }}
            >
              no transcript captured
            </span>
          )}
        </div>
      </aside>
    </div>
  );
}

function PostMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--card)",
        padding: "16px",
        minHeight: 92,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-3xl)",
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        {value}
      </span>
      {hint ? (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            color: "var(--text-tertiary)",
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function PostTranscriptBlock({
  label,
  text,
  accent,
}: {
  label: string;
  text: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        borderLeft: `2px solid ${accent ? ACCENT : "var(--border)"}`,
        paddingLeft: "var(--space-12)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: accent ? ACCENT : "var(--text-tertiary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-base)",
          lineHeight: "22px",
          color: "var(--text-secondary)",
        }}
      >
        {truncateText(text, 220)}
      </span>
    </div>
  );
}

function SandboxHeaderToolbar({
  slug,
  title,
  mode,
  onModeChange,
  bottomOpen,
  sidebarOpen,
  traceOpen,
  onToggleBottom,
  onToggleSidebar,
  onToggleTrace,
  onReset,
  onEnd,
}: {
  slug: string;
  title: string;
  mode: SandboxMode;
  onModeChange: (next: SandboxMode) => void;
  bottomOpen: boolean;
  sidebarOpen: boolean;
  traceOpen: boolean;
  onToggleBottom: () => void;
  onToggleSidebar: () => void;
  onToggleTrace: () => void;
  onReset: () => void;
  onEnd: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
        minWidth: 0,
      }}
    >
      <Pathname
        segments={[
          { label: "characters", href: "/characters" },
          { label: title, href: `/characters/${slug}` },
          {
            label: "sandbox",
            href: `/characters/${slug}/sandbox`,
            tag: true,
          },
        ]}
      />

      <ModeToggle mode={mode} onChange={onModeChange} />

      <div
        style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}
      >
        <button
          type="button"
          onClick={onReset}
          style={{
            padding: "6px 12px",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-secondary)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          reset
        </button>
        <button
          type="button"
          onClick={onEnd}
          style={{
            padding: "6px 12px",
            border: `1px solid ${DANGER}`,
            background: `color-mix(in srgb, ${DANGER} 12%, transparent)`,
            color: DANGER,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          ■ end
        </button>
        <PanelToggleGroup
          bottomOpen={bottomOpen}
          sidebarOpen={sidebarOpen}
          traceOpen={traceOpen}
          onToggleBottom={onToggleBottom}
          onToggleSidebar={onToggleSidebar}
          onToggleTrace={onToggleTrace}
        />
      </div>
    </div>
  );
}

/* ── Toolbar sub-components ───────────────────────────────────── */

function ModeToggle({
  mode,
  onChange,
}: {
  mode: SandboxMode;
  onChange: (next: SandboxMode) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: "1px solid var(--border)",
      }}
    >
      <ModeButton
        active={mode === "voice"}
        onClick={() => onChange("voice")}
        label="voice"
        icon={<MicIcon />}
      />
      <ModeButton
        active={mode === "chat"}
        onClick={() => onChange("chat")}
        label="chat"
        icon={<ChatIcon />}
        leftBorder
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  icon,
  leftBorder,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  leftBorder?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "7px 18px",
        background: active
          ? "var(--accent-fill)"
          : "transparent",
        border: "none",
        borderLeft: leftBorder ? "1px solid var(--border)" : "none",
        color: active ? ACCENT : "var(--text-tertiary)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function PanelToggleGroup({
  bottomOpen,
  sidebarOpen,
  traceOpen,
  onToggleBottom,
  onToggleSidebar,
  onToggleTrace,
}: {
  bottomOpen: boolean;
  sidebarOpen: boolean;
  traceOpen: boolean;
  onToggleBottom: () => void;
  onToggleSidebar: () => void;
  onToggleTrace: () => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: "1px solid var(--border)",
        marginLeft: "var(--space-4)",
      }}
    >
      <IconToggle
        active={bottomOpen}
        onClick={onToggleBottom}
        title="Mission control"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <g stroke="currentColor" strokeWidth={2} fill="none">
            <rect x="3" y="4" width="18" height="16" />
            <line x1="3" y1="14" x2="21" y2="14" />
          </g>
        </svg>
      </IconToggle>
      <IconToggle
        active={sidebarOpen}
        onClick={onToggleSidebar}
        title="Config sidebar"
        leftBorder
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <g stroke="currentColor" strokeWidth={2} fill="none">
            <rect x="3" y="4" width="18" height="16" />
            <line x1="15" y1="4" x2="15" y2="20" />
          </g>
        </svg>
      </IconToggle>
      <IconToggle
        active={traceOpen}
        onClick={onToggleTrace}
        title="Diagnostics panel"
        leftBorder
      >
        <TraceIcon />
      </IconToggle>
    </div>
  );
}

function HeaderTraceToggle({
  active,
  traceCount,
  onClick,
}: {
  active: boolean;
  traceCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title="Diagnostics panel"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
        height: 28,
        padding: "0 10px",
        border: "1px solid var(--border)",
        background: active
          ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
          : "transparent",
        color: active ? ACCENT : "var(--text-tertiary)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      <TraceIcon />
      diagnostics {traceCount > 0 ? traceCount : ""}
    </button>
  );
}

function IconToggle({
  active,
  onClick,
  title,
  leftBorder,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  leftBorder?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 28,
        padding: 0,
        background: active
          ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
          : "transparent",
        border: "none",
        borderLeft: leftBorder ? "1px solid var(--border)" : "none",
        color: active ? ACCENT : "var(--text-tertiary)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function TelemetryStrip({
  elapsedSec,
  ttftMs,
  spent,
  turn,
  tokens,
}: {
  elapsedSec: number;
  ttftMs: number | null;
  spent: number;
  turn: number;
  tokens: number;
}) {
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return (
    <div
      style={{
        position: "absolute",
        top: 32,
        left: 32,
        right: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", gap: "var(--space-24)" }}>
        <span>
          <span style={{ color: ACCENT }}>●</span> live · {clock}
        </span>
        <span>
          ttft{" "}
          <span style={{ color: "var(--text-secondary)" }}>
            {ttftMs != null ? `${ttftMs}ms` : "—"}
          </span>
        </span>
        <span>
          spent{" "}
          <span style={{ color: "var(--text-secondary)" }}>
            {formatCost(spent)}
          </span>
        </span>
      </div>
      <div style={{ display: "flex", gap: "var(--space-24)" }}>
        <span>
          turn{" "}
          <span style={{ color: "var(--text-secondary)" }}>
            {String(turn).padStart(2, "0")}
          </span>
        </span>
        <span>
          tokens{" "}
          <span style={{ color: "var(--text-secondary)" }}>
            {tokens.toLocaleString()}
          </span>{" "}
          / 2,000
        </span>
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

async function createSandboxWorldSession(input: {
  characterId: string;
  characterSlug: string;
  mode: SandboxMode;
  activeModel: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const sceneId = buildSandboxSceneId(input.characterSlug);
  const currentScene = buildInitialSandboxSceneSnapshot(sceneId, input.characterSlug);
  const res = await fetch("/api/world-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      characterId: input.characterId,
      mode: input.mode,
      initialScene: currentScene,
      currentScene,
      metadata: {
        source: "character-sandbox",
        sceneId,
        characterSlug: input.characterSlug,
        activeModel: input.activeModel,
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => `${res.status}`);
    throw new Error(`world-session create failed: ${detail.slice(0, 200)}`);
  }
  const payload = (await res.json()) as { session?: { id?: string } };
  return payload.session?.id ?? id;
}

type SandboxOrchestratorResult = {
  decision: OrchestratorDecision;
  sceneState?: SceneState;
  sceneMemory?: string[];
  orchestrator?: { provider: string; model: string };
  degraded?: boolean;
  reason?: string;
  trace?: TracePayload;
};

async function fetchSandboxOrchestratorDecision(input: {
  sessionId: string;
  sceneId: string;
  character: SandboxCharacter;
  turns: SandboxTurn[];
  lastUserMessage: string;
}): Promise<SandboxOrchestratorResult> {
  const res = await fetch(
    `/api/world-sessions/${encodeURIComponent(input.sessionId)}/orchestrate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sceneId: input.sceneId,
        recentTurns: collectSceneTurns(input.turns, input.character),
        lastUserMessage: input.lastUserMessage,
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => `${res.status}`);
    throw new Error(`orchestrate failed: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as SandboxOrchestratorResult;
}

function buildSandboxSceneId(characterSlug: string): string {
  return `${CHARACTER_SANDBOX_SCENE_PREFIX}${characterSlug}`;
}

function buildInitialSandboxSceneSnapshot(sceneId: string, characterSlug: string) {
  return {
    version: 1 as const,
    sceneId,
    sceneState: {
      sceneId,
      beat: "The sandbox session is open and waiting for the user to begin.",
      presentCharacterSlugs: [characterSlug],
      ambience: null,
      lastSpeakerSlug: null,
      turnIndex: 0,
    },
    sceneMemory: [],
    updatedAt: new Date().toISOString(),
  };
}

function collectSceneTurns(
  turns: SandboxTurn[],
  character: SandboxCharacter,
): Array<{ speakerSlug: string; speakerName?: string; text: string }> {
  return turns
    .filter((turn) => !turn.inFlight && turn.text.trim().length > 0)
    .slice(-8)
    .map((turn) => ({
      speakerSlug: turn.speaker === "user" ? "user" : character.slug,
      speakerName: turn.speaker === "user" ? "User" : character.title,
      text: turn.text.trim(),
    }));
}

function buildSandboxPromptChunk(decision: OrchestratorDecision | null): string | undefined {
  if (!decision || decision.action !== "speak") return undefined;
  const parts = [
    decision.beat ? `Scene direction (orchestrator): ${decision.beat}` : "",
    decision.sceneCue ? `Scene cue: ${decision.sceneCue}` : "",
    decision.beatLabel ? `Beat: ${decision.beatLabel}` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join("\n")}\n\n` : undefined;
}

function buildSandboxExecutionScene(
  character: SandboxCharacter,
  decision: OrchestratorDecision | null,
): { activeEntities?: string[]; location?: string } | undefined {
  if (!decision) {
    return { activeEntities: [character.slug], location: "character sandbox" };
  }
  return {
    activeEntities: [character.slug],
    location:
      decision.beatLabel ??
      decision.beat ??
      decision.sceneCue ??
      "character sandbox",
  };
}

async function endSandboxWorldSession(
  sessionId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/world-sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "ended",
      metadata: {
        source: "character-sandbox",
        ...metadata,
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => `${res.status}`);
    throw new Error(`world-session end failed: ${detail.slice(0, 200)}`);
  }
}

async function uploadSandboxAudioArtifact(input: {
  sessionId: string;
  turnId: string;
  direction: "input" | "output";
  blob: Blob;
  filename: string;
  durationMs: number | null;
  sampleRate?: number | null;
}): Promise<void> {
  if (!input.blob.size) return;
  const form = new FormData();
  form.set("file", input.blob, input.filename);
  form.set("direction", input.direction);
  form.set("turnId", input.turnId);
  if (input.durationMs !== null) form.set("durationMs", String(input.durationMs));
  if (input.sampleRate) form.set("sampleRate", String(input.sampleRate));
  await fetch(`/api/world-sessions/${input.sessionId}/audio`, {
    method: "POST",
    body: form,
  }).catch((err) => {
    console.warn(`[sandbox] ${input.direction} audio artifact upload failed`, err);
  });
}

function buildWavBlob(
  frames: Array<{ pcmBase64: string; samples: number; sampleRate: number }>,
): { blob: Blob; durationMs: number; sampleRate: number } | null {
  const first = frames[0];
  if (!first) return null;
  const sampleRate = first.sampleRate;
  const sampleCount = frames.reduce((sum, frame) => sum + frame.samples, 0);
  if (sampleCount <= 0) return null;

  const pcm = new Float32Array(sampleCount);
  let cursor = 0;
  for (const frame of frames) {
    const chunk = decodeFloat32Base64(frame.pcmBase64);
    pcm.set(chunk.slice(0, frame.samples), cursor);
    cursor += frame.samples;
  }

  return {
    blob: encodeMonoPcm16Wav(pcm, sampleRate),
    durationMs: Math.round((sampleCount / sampleRate) * 1000),
    sampleRate,
  };
}

function decodeFloat32Base64(value: string): Float32Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Float32Array(buffer);
}

function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "bin";
}

function MicIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <g
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </g>
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth={2} fill="none">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </g>
    </svg>
  );
}

function TraceIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <g
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M4 19V5" />
        <path d="M20 19V5" />
        <path d="M8 7h8" />
        <path d="M8 12h5" />
        <path d="M8 17h8" />
      </g>
    </svg>
  );
}

/**
 * Convert the in-memory sandbox turns into the `[ {role, content}, ...]`
 * shape the chat/voice routes expect. Drops in-flight turns (which are
 * the streaming character reply we haven't received yet) and skips
 * system / error rows that don't belong in the prompt history.
 */
function collectHistory(turns: SandboxTurn[]): ChatHistoryTurn[] {
  return turns
    .filter((t) => !t.inFlight && t.text.trim().length > 0)
    .map((t) => ({
      role: t.speaker === "user" ? ("user" as const) : ("assistant" as const),
      content: t.text,
    }));
}

function computeTotals(turns: SandboxTurn[]): {
  tokens: number;
  spent: number;
} {
  let tokens = 0;
  let actualSpent = 0;
  for (const t of turns) tokens += t.tokens ?? 0;
  for (const t of turns) actualSpent += t.estimatedCostUsd ?? 0;
  if (actualSpent > 0) return { tokens, spent: actualSpent };
  // Fallback estimate for in-flight/error turns that never received the
  // server-side model pricing summary.
  const input = tokens * 0.6;
  const output = tokens * 0.4;
  const spent = (input / 1_000_000) * 3 + (output / 1_000_000) * 15;
  return { tokens, spent };
}

function formatCost(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

function formatDurationMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatClockTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateText(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function extractScopeTags(character: SandboxCharacter): string[] {
  const tags = character.identity?.traits?.map((t) => t.name.toLowerCase()) ?? [];
  return tags.filter((t) => t.trim()).slice(0, 3);
}
