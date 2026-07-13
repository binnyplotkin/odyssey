"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { type ModelOption } from "@/lib/model-registry";
import type { OrchestratorDecision, SceneState } from "@odyssey/types";
import { useHeaderContent } from "@/components/header-context";
import { Pathname } from "@/components/pathname";
import {
  PcmPlayer,
  blobToBase64,
  captureMic,
  createAudioContext,
  prepareSandboxVoiceTurn,
  streamVoice,
  transcribeAudio,
  warmSandboxVoiceContext,
  type ChatHistoryTurn,
} from "@/lib/sandbox-streams";
import { Menu, type MenuItem } from "@/components/menu";
import { AudioRtStreamingSttSession } from "@/lib/audio-rt-streaming-stt";
import { ElevenLabsScribeStreamingSttSession } from "@/lib/elevenlabs-scribe-streaming-stt";
import { LiveKitVoiceSession } from "@/lib/livekit-voice-session";
import type { TracePayload } from "@/lib/voice-trace";
import type {
  SandboxBinding,
  SandboxCharacter,
} from "@/app/(authenticated)/characters/[slug]/sandbox/page";
import { SandboxVoiceStage } from "./character-sandbox/sandbox-voice-stage";
import { SandboxChatStage } from "./character-sandbox/sandbox-chat-stage";
import { SandboxPreSession } from "./character-sandbox/sandbox-pre-session";
import {
  SessionIntroExperience,
  prefetchSessionIntroExperience,
  type SessionIntroExperienceHandle,
} from "./character-sandbox/session-intro-experience";
import { SandboxTraceDrawer } from "./character-sandbox/sandbox-trace-drawer";
import {
  WavefieldStage,
  createEmptyAudioData,
  type AudioData,
} from "@/components/wavefield-stage";

/**
 * CharacterSandbox — the V1 HUD Console implementation. Voice (default) ↔
 * chat modes, with one independently dismissible bottom diagnostics panel.
 *
 * The center stage stays as the main body: WavefieldStage sits behind the
 * voice/chat renderer, while diagnostics live below that body when opened.
 *
 * Voice/chat conversation wiring is stubbed for now (mock turns + a no-op
 * mic handler) — the real STT/TTS/LLM stream plugs in via the
 * `onSendMessage` / `onMicToggle` callbacks once the runtime route is
 * ready.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const DANGER = "var(--status-error)";
const CHARACTER_SANDBOX_SCENE_PREFIX = "character-sandbox:";
// When NEXT_PUBLIC_VOICE_AGENT is set, the sandbox drives voice over a LiveKit room
// (browser publishes mic; the voice-agent worker does STT + brain + TTS) instead of
// the audio-rt STT + SSE streamVoice path. Per-environment flip; default keeps the
// existing pipeline untouched.
const VOICE_AGENT_ENABLED = process.env.NEXT_PUBLIC_VOICE_AGENT === "1";
// Debounce after the last STT word before auto-committing the turn. The
// audio-rt gateway delivers a turn's words in ONE burst *after* its own
// server-side end-of-turn detection, so this hold only needs to coalesce that
// single burst — it is not a substitute for turn detection. Lowered from 1500
// now that the gateway runs Smart Turn semantic endpointing (which prevents
// mid-sentence server fires); tune lower once confirmed in prod.
// NOTE: only safe at this value with SMART_TURN_ENABLED=1 on the audio-rt
// service. With fixed-silence (800ms) endpointing a long mid-sentence pause can
// fire the server early, and this short hold would then commit a partial
// utterance — so enable Smart Turn first, then ship this.
const STREAMING_COMMIT_HOLD_MS = 600;
const STT_FALLBACK_MIN_AUDIO_MS = 1200;
const STT_SUSPICIOUS_MAX_CHARS = 8;

export type SandboxMode = "voice" | "chat";
export type SandboxPhase = "pre-session" | "intro" | "live" | "post-session";

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

type SandboxAudioInput = {
  blob: Blob;
  mimeType: string;
  durationMs: number | null;
  chunkCount: number;
  sizeBytes: number;
};

type SttStartReason = "session_start" | "manual_toggle";
type StreamingSttProvider = "audio-rt" | "elevenlabs-scribe";

type MicConnectionStatus = {
  capture: "idle" | "requesting" | "active" | "muted" | "ended" | "error";
  stt: "idle" | "connecting" | "open" | "closed" | "error";
  provider: StreamingSttProvider;
  deviceLabel: string | null;
  mimeType: string | null;
  error: string | null;
};

type MicInputDevice = {
  deviceId: string;
  label: string;
};

const INITIAL_MIC_CONNECTION: MicConnectionStatus = {
  capture: "idle",
  stt: "idle",
  provider: "audio-rt",
  deviceLabel: null,
  mimeType: null,
  error: null,
};

export function CharacterSandbox({ character, bindings, defaultModel }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<SandboxMode>("voice");
  const [debugOpen, setDebugOpen] = useState(false);

  // Session lifecycle. The page lands in the pre-session manifest, advances
  // into a persisted live session, then lands in a post-session review before
  // the author starts another run.
  const [phase, setPhase] = useState<SandboxPhase>("pre-session");
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [worldSessionId, setWorldSessionId] = useState<string | null>(null);
  const worldSessionIdRef = useRef<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [introActive, setIntroActive] = useState(false);
  const [introForegroundVisible, setIntroForegroundVisible] = useState(false);
  const [introSystemsReady, setIntroSystemsReady] = useState(false);
  const [endedSession, setEndedSession] = useState<EndedSandboxSession | null>(
    null,
  );

  const [turns, setTurns] = useState<SandboxTurn[]>([]);
  const [traceRecords, setTraceRecords] = useState<SandboxTraceRecord[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [sttProvider, setSttProvider] =
    useState<StreamingSttProvider>("audio-rt");
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState("");
  const [micInputDevices, setMicInputDevices] = useState<MicInputDevice[]>([]);
  const [micConnection, setMicConnection] = useState<MicConnectionStatus>(
    INITIAL_MIC_CONNECTION,
  );

  // Streaming machinery — abort controller for the in-flight LLM call,
  // PcmPlayer for serial audio playback (voice mode), MediaRecorder
  // refs for mic capture, and a `voiceState` for the wavefield state pill.
  const abortRef = useRef<AbortController | null>(null);
  const pcmPlayerRef = useRef<PcmPlayer | null>(null);
  // LiveKit voice session (when VOICE_AGENT_ENABLED) — replaces the audio-rt STT +
  // streamVoice engine while reusing the same wavefield + state-pill UI.
  const liveKitSessionRef = useRef<LiveKitVoiceSession | null>(null);
  // Shared output AudioContext: created + resumed inside the start gesture so
  // the entry cue plays instantly and TTS playback inherits an unlocked
  // context (Safari leaves contexts created outside a gesture suspended).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sceneInputEnabledRef = useRef(false);
  const introExperienceRef = useRef<SessionIntroExperienceHandle | null>(null);
  const launchSequenceRef = useRef(0);
  const launchInProgressRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef<string>("");
  const recorderStartedAtRef = useRef<number | null>(null);
  const voiceContextWarmRef = useRef<Promise<unknown> | null>(null);
  const streamingSttRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const streamingTranscriptRef = useRef("");
  const streamingTurnIdRef = useRef<string | null>(null);
  const lastPrepareRef = useRef<{ transcript: string; at: number } | null>(
    null,
  );
  const autoCommitTimerRef = useRef<number | null>(null);
  const [voiceState, setVoiceState] = useState<
    "idle" | "listening" | "thinking" | "speaking"
  >("idle");
  const micOnRef = useRef(micOn);
  const selectedMicDeviceIdRef = useRef(selectedMicDeviceId);
  const voiceStateRef = useRef(voiceState);
  const waveAudioRef = useRef<AudioData>(createEmptyAudioData());

  const activeModel = character.brainModel?.model ?? defaultModel;
  const activeVoiceModel =
    character.brainModel?.voice?.model ??
    character.brainModel?.model ??
    activeModel;
  const totals = useMemo(() => computeTotals(turns), [turns]);
  const lastTurn = turns[turns.length - 1] ?? null;

  useEffect(() => {
    micOnRef.current = micOn;
    voiceStateRef.current = voiceState;
  }, [micOn, voiceState]);

  useEffect(() => {
    selectedMicDeviceIdRef.current = selectedMicDeviceId;
  }, [selectedMicDeviceId]);

  const refreshMicInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }))
        .filter((device) => Boolean(device.deviceId));
      setMicInputDevices(inputs);
    } catch (err) {
      console.warn("[sandbox] mic device enumeration failed", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("odyssey:sandbox:mic-device-id");
      if (stored) {
        selectedMicDeviceIdRef.current = stored;
        setSelectedMicDeviceId(stored);
      }
    }

    void refreshMicInputDevices();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    mediaDevices.addEventListener("devicechange", refreshMicInputDevices);
    return () => {
      mediaDevices.removeEventListener("devicechange", refreshMicInputDevices);
    };
  }, [refreshMicInputDevices]);

  // Pre-session heatup. Cache the entry-cue bytes and warm the
  // character-scoped voice-context cache (10 min TTL; session-scoped lookups
  // fall back to it) so the start click only pays for session creation and
  // the STT handshake. Repeat fires are cheap — the route dedupes in-flight
  // builds and serves fresh entries from cache.
  useEffect(() => {
    if (phase !== "pre-session") return;
    prefetchSessionIntroExperience();
    if (mode !== "voice") return;
    void warmSandboxVoiceContext({ characterId: character.id }).catch(
      (err) => {
        console.warn("[sandbox] pre-session voice context warm failed", err);
      },
    );
  }, [phase, mode, character.id]);

  useEffect(() => {
    const audio = waveAudioRef.current;

    const tick = () => {
      if (audio.active) return;
      audio.energy += (0 - audio.energy) * 0.18;
      audio.bass += (0 - audio.bass) * 0.18;
      audio.mid += (0 - audio.mid) * 0.18;
      audio.high += (0 - audio.high) * 0.18;
      audio.peak *= 0.72;
    };

    tick();
    const id = window.setInterval(tick, 80);
    return () => window.clearInterval(id);
  }, []);

  async function handleStart() {
    if (phase !== "pre-session" || launchInProgressRef.current) return;
    launchInProgressRef.current = true;
    const launchSequence = ++launchSequenceRef.current;
    const launchMode: SandboxMode = "voice";
    if (mode !== launchMode) setMode(launchMode);

    // Unlock playback in the start gesture, then mount the mastered intro.
    // Its embedded audio and video share one media clock.
    if (!audioCtxRef.current) audioCtxRef.current = createAudioContext();
    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume().catch(() => {});
    }
    sceneInputEnabledRef.current = false;
    setIntroSystemsReady(false);
    flushSync(() => {
      setPhase("intro");
      setIntroActive(true);
      setIntroForegroundVisible(false);
      setTurns([]);
      setTraceRecords([]);
      setComposerValue("");
      setSessionError(null);
      setEndedSession(null);
      setMicOn(false);
      setVoiceState("idle");
    });
    try {
      const intro = introExperienceRef.current;
      if (!intro) throw new Error("Intro experience failed to mount.");
      await intro.play();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSessionError(message);
      setIntroActive(false);
      setPhase("pre-session");
      launchInProgressRef.current = false;
      return;
    }
    const sessionId = await createSandboxSceneSession({
      characterId: character.id,
      characterSlug: character.slug,
      mode: launchMode,
      activeModel,
      ambienceSlug: character.ambienceSlug ?? null,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setSessionError(message);
      console.warn(
        "[sandbox] world session create failed; launch blocked",
        err,
      );
      return null;
    });
    if (!sessionId || launchSequence !== launchSequenceRef.current) {
      launchInProgressRef.current = false;
      setIntroActive(false);
      setIntroSystemsReady(false);
      worldSessionIdRef.current = null;
      setWorldSessionId(null);
      setPhase("pre-session");
      return;
    }
    worldSessionIdRef.current = sessionId;
    setWorldSessionId(sessionId);
    voiceContextWarmRef.current = warmSandboxVoiceContext({
      characterId: character.id,
      sessionId,
    })
      .then((context) => {
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
      })
      .catch((err) => {
        console.warn("[sandbox] voice context warm failed", err);
        return null;
      });
    try {
      if (VOICE_AGENT_ENABLED) {
        // Join and subscribe during the intro, but keep both directions gated.
        const sessionStart = Date.now();
        const lkSession = new LiveKitVoiceSession({
          onStateChange: (next) => {
            if (!sceneInputEnabledRef.current) return;
            voiceStateRef.current = next;
            setVoiceState(next);
          },
          onAudioMetrics: (metrics) => {
            if (!sceneInputEnabledRef.current) return;
            const wave = waveAudioRef.current;
            wave.energy = metrics.energy;
            wave.bass = metrics.bass;
            wave.mid = metrics.mid;
            wave.high = metrics.high;
            wave.peak = metrics.peak;
            wave.active = metrics.active;
          },
          onTranscript: (segment) => {
            if (!sceneInputEnabledRef.current) return;
            const turnId = `lk-${segment.id}`;
            const speaker = segment.role === "user" ? "user" : "character";
            setTurns((prev) => {
              const idx = prev.findIndex((turn) => turn.id === turnId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = {
                  ...next[idx],
                  text: segment.text,
                  inFlight: !segment.final,
                };
                return next;
              }
              return [
                ...prev,
                {
                  id: turnId,
                  speaker,
                  text: segment.text,
                  timestampMs: Math.max(0, Date.now() - sessionStart),
                  inFlight: !segment.final,
                },
              ];
            });
          },
          onError: (message) => setSessionError(message),
        });
        liveKitSessionRef.current = lkSession;
        await Promise.all([
          voiceContextWarmRef.current,
          lkSession.connect({
            characterId: character.id,
            sessionId,
            audioContext: audioCtxRef.current ?? undefined,
            microphoneEnabled: false,
            outputEnabled: false,
          }),
        ]);
      } else {
        await Promise.all([
          voiceContextWarmRef.current,
          startVoiceInput("session_start", undefined, true),
        ]);
      }
      if (launchSequence === launchSequenceRef.current) {
        setIntroSystemsReady(true);
      }
    } catch (err) {
      if (launchSequence !== launchSequenceRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[sandbox] scene warmup failed", err);
      setSessionError(message);
      sceneInputEnabledRef.current = false;
      void liveKitSessionRef.current?.disconnect();
      liveKitSessionRef.current = null;
      stopStreamingStt();
      stopRecorder();
      setIntroSystemsReady(false);
      setIntroActive(false);
      launchInProgressRef.current = false;
      worldSessionIdRef.current = null;
      setWorldSessionId(null);
      setPhase("pre-session");
    }
  }

  function handleEnd() {
    // End the persisted run and retain the local transcript/telemetry for the
    // post-session review surface.
    abortRef.current?.abort();
    launchSequenceRef.current += 1;
    launchInProgressRef.current = false;
    sceneInputEnabledRef.current = false;
    void liveKitSessionRef.current?.disconnect();
    liveKitSessionRef.current = null;
    pcmPlayerRef.current?.stop();
    stopRecorder();
    stopStreamingStt();
    voiceContextWarmRef.current = null;
    streamingTurnIdRef.current = null;
    lastPrepareRef.current = null;
    setVoiceState("idle");
    setMicOn(false);
    setIntroSystemsReady(false);
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
      characterTurnCount: turns.filter((turn) => turn.speaker === "character")
        .length,
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
      })
        .then(() => {
          setEndedSession((current) =>
            current?.id === sessionId
              ? { ...current, status: "ended", error: null }
              : current,
          );
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          setEndedSession((current) =>
            current?.id === sessionId
              ? { ...current, status: "ended", error: message }
              : current,
          );
        });
    }
  }

  function releasePreparedVoiceInput() {
    sceneInputEnabledRef.current = true;
    for (const track of recorderStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = true;
    }
    recorderChunksRef.current = [];
    recorderStartedAtRef.current = performance.now();
    streamingTranscriptRef.current = "";
    streamingTurnIdRef.current = `chr-${crypto.randomUUID()}`;
    lastPrepareRef.current = null;
    micOnRef.current = true;
    voiceStateRef.current = "listening";
    setMicOn(true);
    setVoiceState("listening");
  }

  async function handleEntryTransitionComplete() {
    if (!introSystemsReady) return;
    flushSync(() => {
      setStartedAt(Date.now());
      setIntroActive(false);
      setPhase("live");
    });
    launchInProgressRef.current = false;
    sceneInputEnabledRef.current = true;
    if (VOICE_AGENT_ENABLED) {
      try {
        await liveKitSessionRef.current?.activate();
        micOnRef.current = true;
        setMicOn(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSessionError(message);
        console.warn("[sandbox] livekit scene activation failed", err);
      }
    } else {
      releasePreparedVoiceInput();
    }
  }

  function handleCancel() {
    router.push(`/characters/${character.slug}`);
  }

  function handlePrepareNextSession() {
    abortRef.current?.abort();
    launchSequenceRef.current += 1;
    launchInProgressRef.current = false;
    sceneInputEnabledRef.current = false;
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
    setMode("voice");
    setVoiceState("idle");
    setMicOn(false);
    setIntroSystemsReady(false);
    setPhase("pre-session");
  }

  function handleModeChange(nextMode: SandboxMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
  }

  /* ── Unified text/voice send ───────────────────────────────── */

  const sendUtterance = useCallback(
    async (
      text: string,
      audioInput?: { blob: Blob; mimeType: string; durationMs: number | null },
      options?: { turnId?: string },
    ): Promise<void> => {
      if (!sceneInputEnabledRef.current) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const now = Date.now();
      const userTurnId = `you-${now}`;
      const characterTurnId = options?.turnId ?? `chr-${now}`;
      const sessionId = worldSessionIdRef.current;
      const sceneId = buildSandboxSceneId(character.slug);
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
      voiceStateRef.current = "thinking";
      setVoiceState("thinking");

      const finalize = (update: (turn: SandboxTurn) => SandboxTurn) => {
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
              console.warn(
                "[sandbox] orchestrator failed; using direct character stream",
                err,
              );
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
            console.warn(
              "[sandbox] orchestrator degraded:",
              orchestration.reason,
            );
          } else if (decision.action === "end-scene") {
            finalize((t) => ({
              ...t,
              inFlight: false,
              text: "[scene ended by orchestrator]",
              provider:
                orchestration.orchestrator?.provider ?? t.provider ?? null,
              model: orchestration.orchestrator?.model ?? t.model ?? null,
            }));
            voiceStateRef.current = "idle";
            setVoiceState("idle");
            return;
          }
        }

        const decision =
          orchestration && !orchestration.degraded
            ? orchestration.decision
            : null;
        const promptChunk = buildSandboxPromptChunk(decision, character);
        const executionScene = buildSandboxExecutionScene(character, decision);

        // Always use the voice stream so typed chat and mic input share the
        // same orchestrated character response, TTS playback, and trace path.
        const syncPlaybackState = (playing: boolean) => {
          const nextVoiceState = playing
            ? "speaking"
            : micOnRef.current
              ? "listening"
              : "idle";
          if (voiceStateRef.current === nextVoiceState) return;
          voiceStateRef.current = nextVoiceState;
          setVoiceState(nextVoiceState);
        };
        const syncWaveformAudio = (audio: AudioData) => {
          const wave = waveAudioRef.current;
          wave.energy = audio.energy;
          wave.bass = audio.bass;
          wave.mid = audio.mid;
          wave.high = audio.high;
          wave.peak = audio.peak;
          wave.active = audio.active;
        };
        if (!pcmPlayerRef.current) {
          pcmPlayerRef.current = new PcmPlayer(
            audioCtxRef.current ?? undefined,
            {
              onPlaybackStateChange: syncPlaybackState,
              onAudioMetrics: syncWaveformAudio,
            },
          );
        } else {
          pcmPlayerRef.current.setCallbacks({
            onPlaybackStateChange: syncPlaybackState,
            onAudioMetrics: syncWaveformAudio,
          });
        }
        if (voiceContextWarmRef.current) {
          await Promise.race([
            voiceContextWarmRef.current,
            new Promise((resolve) => window.setTimeout(resolve, 150)),
          ]);
        }
        let firstAudioAt: number | null = null;
        const outputFrames: Array<{
          pcmBase64: string;
          samples: number;
          sampleRate: number;
        }> = [];
        await streamVoice({
          characterId: character.id,
          sessionId,
          turnId: characterTurnId,
          promptChunk,
          message: trimmed,
          history,
          scene: executionScene,
          model: activeVoiceModel,
          ackMode: "off",
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
              finalize((t) => ({
                ...t,
                text: t.text + delta,
              }));
            },
            onFirstAudio: (latencyMs) => {
              firstAudioAt = performance.now();
              voiceStateRef.current = "speaking";
              setVoiceState("speaking");
              finalize((t) => ({
                ...t,
                ttftMs: t.ttftMs ?? latencyMs,
              }));
            },
            onAudio: (pcm, samples, rate) => {
              outputFrames.push({
                pcmBase64: pcm,
                samples,
                sampleRate: rate,
              });
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
                  typeof done.inputTokens === "number" ||
                  typeof done.outputTokens === "number"
                    ? (done.inputTokens ?? 0) + (done.outputTokens ?? 0)
                    : Math.ceil(t.text.length / 4),
                provider: done.provider ?? t.provider ?? null,
                model: done.model ?? t.model ?? null,
                estimatedCostUsd: done.estimatedCostUsd ?? t.estimatedCostUsd,
                trace: done.serverTrace ?? t.trace,
              }));
              if (outputFrames.length === 0) {
                const nextVoiceState = micOnRef.current ? "listening" : "idle";
                if (nextVoiceState === "listening") {
                  recorderChunksRef.current = [];
                  recorderStartedAtRef.current = performance.now();
                }
                voiceStateRef.current = nextVoiceState;
                setVoiceState(nextVoiceState);
              }
            },
            onError: (msg) => {
              finalize((t) => ({
                ...t,
                inFlight: false,
                text: t.text || `[error: ${msg}]`,
              }));
              recorderChunksRef.current = [];
              recorderStartedAtRef.current = micOnRef.current ? performance.now() : null;
              const nextVoiceState = micOnRef.current ? "listening" : "idle";
              voiceStateRef.current = nextVoiceState;
              setVoiceState(nextVoiceState);
            },
          },
        });
      } catch (err) {
        // AbortError lands here when the user ends the session mid-stream;
        // the turn is already marked done by handleEnd, so just swallow it.
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
    [character, turns, startedAt, activeVoiceModel],
  );

  function handleSendText() {
    void sendUtterance(composerValue);
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
        const res = await fetch(`/api/characters/${character.id}/directive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directive: nextDirective }),
        });
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
    setMicConnection((current) => ({
      ...current,
      capture: "idle",
      stt: "idle",
      error: null,
    }));
  }

  async function takeRecordedAudioInput(): Promise<SandboxAudioInput | undefined> {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.requestData();
        await new Promise((resolve) => window.setTimeout(resolve, 60));
      } catch {
        /* requestData can throw if the recorder is already stopping. */
      }
    }

    const chunks = recorderChunksRef.current;
    if (chunks.length === 0) {
      recorderStartedAtRef.current = performance.now();
      return undefined;
    }

    recorderChunksRef.current = [];
    const mimeType = recorderMimeRef.current || chunks[0]?.type || "audio/webm";
    const capturedAt = performance.now();
    const durationMs =
      recorderStartedAtRef.current === null
        ? null
        : Math.max(0, Math.round(capturedAt - recorderStartedAtRef.current));
    recorderStartedAtRef.current = capturedAt;

    const blob = new Blob(chunks, { type: mimeType });
    return {
      blob,
      mimeType,
      durationMs,
      chunkCount: chunks.length,
      sizeBytes: blob.size,
    };
  }

  async function resolveBestStreamingTranscript(input: {
    transcript: string;
    audioInput?: SandboxAudioInput;
    turnId: string;
    reason: "auto_commit" | "manual_stop";
  }): Promise<string> {
    const streamingTranscript = input.transcript.trim();
    const durationMs = input.audioInput?.durationMs ?? null;
    const hasRecordedAudio = Boolean(input.audioInput?.blob.size);
    // Only re-transcribe when the live transcript is genuinely EMPTY. The old
    // "suspicious → batch re-transcribe, keep whichever is longer" path replaced
    // clean live transcripts with longer-but-hallucinated batch output (whisper
    // repeats on a blob → "So long. And long. So long."), garbling good speech.
    // Trust the audio-rt streaming transcript whenever it has content.
    const shouldFallback = hasRecordedAudio && streamingTranscript.length === 0;
    if (!shouldFallback || !input.audioInput) return streamingTranscript;

    const audioInput = input.audioInput;
    const startedAtMs = performance.now();
    try {
      const audioBase64 = await blobToBase64(audioInput.blob);
      const result = await transcribeAudio(audioBase64, audioInput.mimeType);
      const batchTranscript = result.transcript.trim();
      const selectedTranscript =
        batchTranscript.length > streamingTranscript.length
          ? batchTranscript
          : streamingTranscript;
      setTraceRecords((prev) => [
        ...prev.slice(-49),
        {
          id: `stt-fallback-${input.turnId}`,
          turnId: input.turnId,
          kind: "session",
          at: new Date().toISOString(),
          trace: {
            startedAt: new Date(Date.now() - Math.round(result.latencyMs)).toISOString(),
            elapsedMs: result.latencyMs,
            events: [
              {
                name: "sandbox.stt.batch_fallback",
                elapsedMs: result.latencyMs,
                meta: {
                  reason: input.reason,
                  streamingTranscript,
                  batchTranscript,
                  selectedTranscript,
                  durationMs,
                  mimeType: audioInput.mimeType,
                  audioSizeBytes: audioInput.sizeBytes,
                  audioChunkCount: audioInput.chunkCount,
                },
              },
            ],
          } as TracePayload,
          meta: {
            provider: result.provider,
            model: result.model,
            totalMs: result.latencyMs,
          },
        },
      ]);
      return selectedTranscript;
    } catch (err) {
      const elapsedMs = Math.round(performance.now() - startedAtMs);
      setTraceRecords((prev) => [
        ...prev.slice(-49),
        {
          id: `stt-fallback-error-${input.turnId}`,
          turnId: input.turnId,
          kind: "session",
          at: new Date().toISOString(),
          trace: {
            startedAt: new Date(Date.now() - elapsedMs).toISOString(),
            elapsedMs,
            events: [
              {
                name: "sandbox.stt.batch_fallback.error",
                elapsedMs,
                meta: {
                  reason: input.reason,
                  streamingTranscript,
                  durationMs,
                  audioSizeBytes: input.audioInput?.sizeBytes ?? null,
                  audioChunkCount: input.audioInput?.chunkCount ?? null,
                  message: err instanceof Error ? err.message : String(err),
                },
              },
            ],
          } as TracePayload,
          meta: {
            provider: "stt-fallback",
            model: null,
            totalMs: elapsedMs,
          },
        },
      ]);
      return streamingTranscript;
    }
  }

  function stopStreamingStt() {
    clearStreamingCommitTimer();
    const session = streamingSttRef.current;
    streamingSttRef.current = null;
    setMicConnection((current) => ({
      ...current,
      stt: "idle",
    }));
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
    if (last && (partial === last.transcript || now - last.at < 350)) {
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

  function clearStreamingCommitTimer() {
    if (autoCommitTimerRef.current !== null) {
      window.clearTimeout(autoCommitTimerRef.current);
      autoCommitTimerRef.current = null;
    }
  }

  async function commitStreamingTranscript() {
    clearStreamingCommitTimer();
    if (voiceStateRef.current !== "listening") return;
    const transcript = streamingTranscriptRef.current.trim();
    if (!transcript) return;
    const turnId = streamingTurnIdRef.current ?? `chr-${crypto.randomUUID()}`;
    voiceStateRef.current = "thinking";
    setVoiceState("thinking");
    const audioInput = await takeRecordedAudioInput();
    const finalTranscript = await resolveBestStreamingTranscript({
      transcript,
      audioInput,
      turnId,
      reason: "auto_commit",
    });
    streamingTranscriptRef.current = "";
    streamingTurnIdRef.current = `chr-${crypto.randomUUID()}`;
    lastPrepareRef.current = null;
    await sendUtterance(finalTranscript, audioInput, { turnId });
  }

  function scheduleStreamingCommit() {
    clearStreamingCommitTimer();
    autoCommitTimerRef.current = window.setTimeout(() => {
      autoCommitTimerRef.current = null;
      void commitStreamingTranscript();
    }, STREAMING_COMMIT_HOLD_MS);
  }

  function recordStreamingSttTrace(input: {
    id: string;
    name: string;
    startedAtMs: number;
    meta?: Record<string, unknown> & { provider?: StreamingSttProvider };
  }) {
    const elapsedMs = Math.round(performance.now() - input.startedAtMs);
    setTraceRecords((prev) => [
      ...prev.slice(-49),
      {
        id: `${input.id}-${Date.now()}`,
        kind: "session",
        at: new Date().toISOString(),
        trace: {
          startedAt: new Date(Date.now() - elapsedMs).toISOString(),
          elapsedMs,
          events: [
            {
              name: input.name,
              elapsedMs,
              meta: input.meta ?? {},
            },
          ],
        } as TracePayload,
        meta: {
          provider: input.meta?.provider ?? "audio-rt",
          model: "streaming-stt",
          totalMs: elapsedMs,
        },
      },
    ]);
  }

  function recordSttDecisionTrace(input: {
    turnId?: string | null;
    name: string;
    meta?: Record<string, unknown>;
  }) {
    setTraceRecords((prev) => [
      ...prev.slice(-49),
      {
        id: `${input.name}-${Date.now()}`,
        turnId: input.turnId ?? undefined,
        kind: "session",
        at: new Date().toISOString(),
        trace: {
          startedAt: new Date().toISOString(),
          elapsedMs: 0,
          events: [
            {
              name: input.name,
              elapsedMs: 0,
              meta: input.meta ?? {},
            },
          ],
        } as TracePayload,
        meta: {
          provider: "stt-flow",
          model: null,
          totalMs: 0,
        },
      },
    ]);
  }

  function handleStreamingTranscript(text: string) {
    if (!sceneInputEnabledRef.current) return;
    if (voiceStateRef.current !== "listening") return;
    const next = text.trim();
    if (!next || next === streamingTranscriptRef.current.trim()) return;
    streamingTranscriptRef.current = next;
    prepareVoiceContextFromPartial(next);
    scheduleStreamingCommit();
  }

  async function startVoiceInput(
    reason: SttStartReason = "manual_toggle",
    providerOverride?: StreamingSttProvider,
    gated = false,
  ): Promise<void> {
    if (micOnRef.current || recorderRef.current || streamingSttRef.current) return;
    const sttStartedAt = performance.now();
    const provider = providerOverride ?? sttProvider;
    const selectedDeviceId = selectedMicDeviceIdRef.current || undefined;
    const selectedDeviceLabel =
      micInputDevices.find((device) => device.deviceId === selectedDeviceId)
        ?.label ?? null;
    setMicConnection((current) => ({
      ...current,
      capture: "requesting",
      stt: "idle",
      provider,
      deviceLabel: selectedDeviceLabel ?? current.deviceLabel,
      error: null,
    }));
    try {
      const { recorder, stream, mimeType } = await captureMic({
        deviceId: selectedDeviceId,
      });
      void refreshMicInputDevices();
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      recorderMimeRef.current = mimeType || "audio/webm";
      const primaryTrack = stream.getAudioTracks()[0] ?? null;
      if (gated && primaryTrack) primaryTrack.enabled = false;
      const syncTrackStatus = () => {
        setMicConnection((current) => ({
          ...current,
          capture: !primaryTrack
            ? "error"
            : primaryTrack.readyState === "ended"
              ? "ended"
              : primaryTrack.muted || !primaryTrack.enabled
                ? "muted"
                : "active",
          deviceLabel: primaryTrack?.label || current.deviceLabel,
          mimeType: recorderMimeRef.current,
          error: primaryTrack ? null : "No audio input track was captured.",
        }));
      };
      if (primaryTrack) {
        primaryTrack.onmute = syncTrackStatus;
        primaryTrack.onunmute = syncTrackStatus;
        primaryTrack.onended = syncTrackStatus;
      }
      syncTrackStatus();
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
      const elevenLabsStreamingSession =
        provider === "elevenlabs-scribe"
          ? new ElevenLabsScribeStreamingSttSession()
          : null;
      const activeStreamingSession =
        elevenLabsStreamingSession ?? streamingSession;
      streamingSttRef.current = activeStreamingSession;
      let streamingReadySettled = false;
      let resolveStreamingReady = () => {};
      const streamingReady = new Promise<void>((resolve) => {
        resolveStreamingReady = resolve;
      });
      const markStreamingReady = () => {
        if (streamingReadySettled) return;
        streamingReadySettled = true;
        resolveStreamingReady();
      };
      setMicConnection((current) => ({
        ...current,
        provider,
        stt: "connecting",
      }));
      recordStreamingSttTrace({
        id: "stt-warmup-started",
        name: "sandbox.stt.warmup_started",
        startedAtMs: sttStartedAt,
        meta: {
          reason,
          provider,
          mimeType: recorderMimeRef.current,
          requestedDeviceId: selectedDeviceId ?? "default",
        },
      });
      recordSttDecisionTrace({
        name: "sandbox.stt.recorder_started",
        meta: {
          reason,
          provider,
          mimeType: recorderMimeRef.current,
          requestedDeviceId: selectedDeviceId ?? "default",
          trackStates: stream.getAudioTracks().map((track) => ({
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            label: track.label,
          })),
        },
      });
      const handleOpen = () => {
        markStreamingReady();
        setMicConnection((current) => ({
          ...current,
          provider,
          stt: "open",
          error: null,
        }));
        recordStreamingSttTrace({
          id: "stt-stream-open",
          name: "sandbox.stt.streaming_open",
          startedAtMs: sttStartedAt,
          meta: {
            reason,
            provider,
            mimeType: recorderMimeRef.current,
            requestedDeviceId: selectedDeviceId ?? "default",
          },
        });
      };
      const handleError = (message: string) => {
        markStreamingReady();
        console.warn("[sandbox] streaming STT error", message);
        setMicConnection((current) => ({
          ...current,
          provider,
          stt: "error",
          error: message,
        }));
        recordStreamingSttTrace({
          id: "stt-stream-error",
          name: "sandbox.stt.streaming_error",
          startedAtMs: sttStartedAt,
          meta: {
            reason,
            provider,
            message,
          },
        });
      };
      const handleClose = () => {
        if (streamingSttRef.current === activeStreamingSession) {
          streamingSttRef.current = null;
          setMicConnection((current) => ({
            ...current,
            provider,
            stt: micOnRef.current ? "closed" : "idle",
          }));
        }
      };

      const startPromise = elevenLabsStreamingSession
        ? elevenLabsStreamingSession.start(stream, {
            onOpen: handleOpen,
            onPartialTranscript: handleStreamingTranscript,
            onCommittedTranscript: handleStreamingTranscript,
            onError: handleError,
            onClose: handleClose,
          })
        : streamingSession.start(stream, {
          onOpen: () => {
            handleOpen();
          },
          onWord: (word) => {
            if (voiceStateRef.current !== "listening") return;
            const next = [streamingTranscriptRef.current, word]
              .filter(Boolean)
              .join(" ")
              .trim();
            handleStreamingTranscript(next);
          },
          onTiming: (timing) => {
            // Endpointing gap (voice stop → transcript) — the latency segment
            // before the brain+voice pipeline. Surfaces inline in the trace panel.
            recordSttDecisionTrace({
              name: "sandbox.stt.endpoint_timing",
              meta: timing,
            });
          },
          onError: handleError,
          onClose: handleClose,
        });

      void startPromise
        .catch((err) => {
          markStreamingReady();
          console.warn(
            "[sandbox] streaming STT start failed; blob STT fallback remains active",
            err,
          );
          if (streamingSttRef.current === activeStreamingSession) {
            streamingSttRef.current = null;
          }
          setMicConnection((current) => ({
            ...current,
            provider,
            stt: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
          recordStreamingSttTrace({
            id: "stt-start-error",
            name: "sandbox.stt.start_error",
            startedAtMs: sttStartedAt,
            meta: {
              reason,
              provider,
              message: err instanceof Error ? err.message : String(err),
            },
          });
        });
      if (gated) {
        micOnRef.current = false;
        voiceStateRef.current = "idle";
        setMicOn(false);
        setVoiceState("idle");
      } else {
        sceneInputEnabledRef.current = true;
        micOnRef.current = true;
        voiceStateRef.current = "listening";
        setMicOn(true);
        setVoiceState("listening");
      }
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 5_000);
        void streamingReady.then(() => {
          window.clearTimeout(timeout);
          resolve();
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMicConnection((current) => ({
        ...current,
        capture: "error",
        stt: "idle",
        error: msg,
      }));
      setTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          speaker: "character",
          text: `[mic error: ${msg}]`,
          timestampMs: Date.now() - startedAt,
        },
      ]);
      micOnRef.current = false;
      voiceStateRef.current = "idle";
      setVoiceState("idle");
      setMicOn(false);
      streamingTurnIdRef.current = null;
      lastPrepareRef.current = null;
      recordStreamingSttTrace({
        id: "stt-capture-error",
        name: "sandbox.stt.capture_error",
        startedAtMs: sttStartedAt,
        meta: {
          reason,
          message: msg,
          requestedDeviceId: selectedDeviceId ?? "default",
        },
      });
    }
  }

  async function handleMicToggle() {
    if (VOICE_AGENT_ENABLED) {
      // LiveKit path: continuous mic + server-side turn detection, so the toggle
      // just mutes/unmutes the published track (no manual commit-and-send).
      const next = !micOnRef.current;
      micOnRef.current = next;
      setMicOn(next);
      await liveKitSessionRef.current?.setMicEnabled(next);
      return;
    }
    if (micOn) {
      clearStreamingCommitTimer();
      const transcript = streamingTranscriptRef.current.trim();
      const preparedTurnId =
        streamingTurnIdRef.current ?? `chr-${crypto.randomUUID()}`;
      streamingTranscriptRef.current = "";
      streamingTurnIdRef.current = null;
      lastPrepareRef.current = null;
      micOnRef.current = false;
      setMicOn(false);
      stopStreamingStt();
      const audioInput = await takeRecordedAudioInput();
      const hasRecordedAudio = Boolean(audioInput?.sizeBytes);
      recordSttDecisionTrace({
        turnId: preparedTurnId,
        name: "sandbox.stt.manual_stop_captured",
        meta: {
          streamingTranscript: transcript,
          audioCaptured: hasRecordedAudio,
          audioSizeBytes: audioInput?.sizeBytes ?? 0,
          audioChunkCount: audioInput?.chunkCount ?? 0,
          durationMs: audioInput?.durationMs ?? null,
          mimeType: audioInput?.mimeType ?? recorderMimeRef.current,
        },
      });
      voiceStateRef.current = transcript || hasRecordedAudio ? "thinking" : "idle";
      setVoiceState(transcript || hasRecordedAudio ? "thinking" : "idle");
      stopRecorder();
      const finalTranscript = await resolveBestStreamingTranscript({
        transcript,
        audioInput,
        turnId: preparedTurnId,
        reason: "manual_stop",
      });
      if (finalTranscript.trim()) {
        await sendUtterance(finalTranscript, audioInput, { turnId: preparedTurnId });
      } else {
        recordSttDecisionTrace({
          turnId: preparedTurnId,
          name: "sandbox.stt.no_transcript_after_stop",
          meta: {
            streamingTranscript: transcript,
            audioCaptured: hasRecordedAudio,
            audioSizeBytes: audioInput?.sizeBytes ?? 0,
            audioChunkCount: audioInput?.chunkCount ?? 0,
            durationMs: audioInput?.durationMs ?? null,
          },
        });
        voiceStateRef.current = "idle";
        setVoiceState("idle");
      }
      return;
    }

    await startVoiceInput("manual_toggle");
  }

  async function handleSttProviderChange(nextProvider: StreamingSttProvider) {
    if (nextProvider === sttProvider) return;
    setSttProvider(nextProvider);
    setMicConnection((current) => ({
      ...current,
      provider: nextProvider,
      stt: current.capture === "idle" ? "idle" : current.stt,
      error: null,
    }));

    if (phase !== "live") return;
    if (!micOnRef.current && !recorderRef.current && !streamingSttRef.current) {
      return;
    }

    clearStreamingCommitTimer();
    streamingTranscriptRef.current = "";
    streamingTurnIdRef.current = `chr-${crypto.randomUUID()}`;
    lastPrepareRef.current = null;
    micOnRef.current = false;
    voiceStateRef.current = "idle";
    setMicOn(false);
    setVoiceState("idle");
    stopStreamingStt();
    stopRecorder();
    await startVoiceInput("manual_toggle", nextProvider);
  }

  async function handleMicDeviceChange(nextDeviceId: string) {
    if (nextDeviceId === selectedMicDeviceIdRef.current) return;
    selectedMicDeviceIdRef.current = nextDeviceId;
    setSelectedMicDeviceId(nextDeviceId);
    if (typeof window !== "undefined") {
      if (nextDeviceId) {
        window.localStorage.setItem("odyssey:sandbox:mic-device-id", nextDeviceId);
      } else {
        window.localStorage.removeItem("odyssey:sandbox:mic-device-id");
      }
    }

    const nextDeviceLabel =
      micInputDevices.find((device) => device.deviceId === nextDeviceId)
        ?.label ?? null;
    setMicConnection((current) => ({
      ...current,
      deviceLabel: nextDeviceLabel,
      error: null,
    }));

    if (phase !== "live") return;
    if (!micOnRef.current && !recorderRef.current && !streamingSttRef.current) {
      return;
    }

    recordSttDecisionTrace({
      name: "sandbox.stt.input_device_changed",
      meta: {
        deviceId: nextDeviceId || "default",
        deviceLabel: nextDeviceLabel ?? "Default input",
      },
    });
    clearStreamingCommitTimer();
    streamingTranscriptRef.current = "";
    streamingTurnIdRef.current = `chr-${crypto.randomUUID()}`;
    lastPrepareRef.current = null;
    micOnRef.current = false;
    voiceStateRef.current = "idle";
    setMicOn(false);
    setVoiceState("idle");
    stopStreamingStt();
    stopRecorder();
    await startVoiceInput("manual_toggle");
  }

  // Tear down audio + mic on unmount so background sessions don't keep
  // streaming after the user navigates away.
  useEffect(() => {
    return () => {
      launchSequenceRef.current += 1;
      launchInProgressRef.current = false;
      sceneInputEnabledRef.current = false;
      abortRef.current?.abort();
      pcmPlayerRef.current?.stop();
      pcmPlayerRef.current = null;
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
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
          onModeChange={handleModeChange}
          micInputDevices={micInputDevices}
          selectedMicDeviceId={selectedMicDeviceId}
          onMicDeviceChange={(next) => void handleMicDeviceChange(next)}
          debugOpen={debugOpen}
          traceCount={traceRecords.length}
          onToggleDebug={() => setDebugOpen((v) => !v)}
          onEnd={handleEnd}
        />
      ) : phase === "post-session" ? (
        <SandboxPostSessionToolbar
          slug={character.slug}
          title={character.title}
          sessionId={endedSession?.id ?? worldSessionId}
          debugOpen={debugOpen}
          traceCount={traceRecords.length}
          onToggleDebug={() => setDebugOpen((v) => !v)}
          onStartNext={handlePrepareNextSession}
        />
      ) : (
        <SandboxPreSessionToolbar
          slug={character.slug}
          title={character.title}
          debugOpen={debugOpen}
          traceCount={traceRecords.length}
          onToggleDebug={() => setDebugOpen((v) => !v)}
        />
      ),
    );
    return () => setContent(null);
    // `handleEnd` is stable enough across renders that we only re-push when
    // the user-facing state actually changes.
  }, [
    setContent,
    character.slug,
    character.title,
    mode,
    micInputDevices,
    selectedMicDeviceId,
    debugOpen,
    traceRecords.length,
    phase,
    endedSession?.id,
    worldSessionId,
  ]);

  return (
    // /characters/* is a flush route — admin-shell drops <main>'s padding to
    // 0 and <main> itself owns the (100vh - header) height via flex:1. We
    // fill that space exactly so the outer <main> never has to scroll.
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--background)",
        color: "var(--text-primary)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {phase === "pre-session" ? (
          <SandboxPreSession
            character={character}
            bindings={bindings}
            activeModel={activeModel}
            sessionError={sessionError}
            onStart={handleStart}
            onCancel={handleCancel}
          />
        ) : phase === "post-session" && endedSession ? (
          <SandboxPostSession
            character={character}
            summary={endedSession}
            turns={turns}
            traceRecords={traceRecords}
            sttProvider={sttProvider}
            onStartNext={handlePrepareNextSession}
            onReturnToCharacter={handleCancel}
          />
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <SandboxWavefieldCell audioData={waveAudioRef.current} />
            <div
              aria-hidden={phase !== "live" && !introForegroundVisible}
              style={{
                position: "relative",
                zIndex: 1,
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                visibility:
                  phase === "live" || introForegroundVisible
                    ? "visible"
                    : "hidden",
                opacity: phase === "live" || introForegroundVisible ? 1 : 0,
                filter:
                  phase === "live" || introForegroundVisible
                    ? "blur(0px)"
                    : "blur(10px)",
                transition:
                  "opacity 1500ms cubic-bezier(.22,.61,.36,1), filter 1500ms cubic-bezier(.22,.61,.36,1)",
              }}
            >
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
                  state={voiceState}
                />
              ) : (
                <SandboxChatStage
                  character={character}
                  turns={turns}
                  composerValue={composerValue}
                  onComposerChange={setComposerValue}
                  onSend={handleSendText}
                  micOn={micOn}
                  voiceState={voiceState}
                  onMicToggle={() => void handleMicToggle()}
                  savedTurnIds={savedTurnIds}
                  onSaveExample={handleSaveExample}
                />
              )}
            </div>
            <SessionIntroExperience
              ref={introExperienceRef}
              active={introActive}
              readyToReveal={introSystemsReady}
              onForegroundReveal={() => setIntroForegroundVisible(true)}
              onComplete={() => void handleEntryTransitionComplete()}
            />
          </div>
        )}
      </div>
      <SandboxTraceDrawer
        open={debugOpen}
        phase={phase}
        mode={mode}
        records={traceRecords}
        characterId={character.id}
        characterTitle={character.title}
        sessionId={worldSessionId}
        sessionError={sessionError}
        chatModel={activeModel}
        voiceModel={activeVoiceModel}
        onClose={() => setDebugOpen(false)}
      />
    </div>
  );
}

function SandboxWavefieldCell({
  audioData,
}: {
  audioData: AudioData;
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <WavefieldStage audioData={audioData} idleMotion="ambient" />
    </div>
  );
}

/* ── Header toolbar ───────────────────────────────────────────── */

function SandboxPreSessionToolbar({
  slug,
  title,
  debugOpen,
  traceCount,
  onToggleDebug,
}: {
  slug: string;
  title: string;
  debugOpen: boolean;
  traceCount: number;
  onToggleDebug: () => void;
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          flexShrink: 0,
        }}
      >
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
        <HeaderDebugToggle
          active={debugOpen}
          traceCount={traceCount}
          onClick={onToggleDebug}
        />
      </div>
    </div>
  );
}

function SandboxPostSessionToolbar({
  slug,
  title,
  sessionId,
  debugOpen,
  traceCount,
  onToggleDebug,
  onStartNext,
}: {
  slug: string;
  title: string;
  sessionId: string | null;
  debugOpen: boolean;
  traceCount: number;
  onToggleDebug: () => void;
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          flexShrink: 0,
        }}
      >
        {sessionId ? (
          <a
            href={`/sessions/${encodeURIComponent(sessionId)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 30,
              padding: "0 14px",
              border:
                "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
              borderRadius: "var(--radius-pill)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            view session
          </a>
        ) : null}
        <button
          type="button"
          onClick={onStartNext}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 30,
            padding: "0 16px",
            border: `1px solid ${ACCENT}`,
            borderRadius: "var(--radius-pill)",
            background: ACCENT,
            color: "var(--accent-on)",
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-base)",
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          new run
        </button>
        <HeaderDebugToggle
          active={debugOpen}
          traceCount={traceCount}
          onClick={onToggleDebug}
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
  sttProvider,
  onStartNext,
  onReturnToCharacter,
}: {
  character: SandboxCharacter;
  summary: EndedSandboxSession;
  turns: SandboxTurn[];
  traceRecords: SandboxTraceRecord[];
  sttProvider: StreamingSttProvider;
  onStartNext: () => void;
  onReturnToCharacter: () => void;
}) {
  const recentTurns = turns.slice(-6);
  const firstUserTurn = turns.find((turn) => turn.speaker === "user");
  const lastCharacterTurn = [...turns]
    .reverse()
    .find((turn) => turn.speaker === "character" && turn.text.trim());
  const statusLabel = summary.error
    ? "ended · sync warning"
    : summary.status === "ending"
      ? "ending session"
      : "ended";
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyDebugTrace() {
    setCopyStatus("copying");
    setCopyError(null);
    try {
      const res = await fetch(`/api/scene-sessions/${encodeURIComponent(summary.id)}/detail`, {
        cache: "no-store",
      });
      const persisted = res.ok
        ? await res.json()
        : { error: `session detail fetch failed (${res.status})`, body: await res.text() };
      const payload = {
        copiedAt: new Date().toISOString(),
        url: typeof window !== "undefined" ? window.location.href : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        sandbox: "character",
        character: {
          id: character.id,
          slug: character.slug,
          title: character.title,
          voiceSlug: character.voiceSlug,
          voiceName: character.voiceName,
          voiceProvider: character.voiceProvider,
          activeModel: character.brainModel?.model ?? null,
          activeVoiceModel:
            character.brainModel?.voice?.model ?? character.brainModel?.model ?? null,
          sttProvider,
        },
        summary,
        localTurns: turns,
        localTraceRecords: traceRecords,
        persisted,
      };
      await copyTextToClipboard(JSON.stringify(payload, null, 2));
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2400);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : String(err));
      setCopyStatus("error");
    }
  }

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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-12)",
            maxWidth: 880,
          }}
        >
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
                border:
                  "1px solid color-mix(in srgb, var(--status-error) 45%, transparent)",
                background:
                  "color-mix(in srgb, var(--status-error) 10%, transparent)",
                color: DANGER,
                padding: "12px 14px",
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                lineHeight: "18px",
              }}
            >
              The local review is available, but the final session-ended update
              failed: {summary.error}
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
          <PostMetric
            label="duration"
            value={formatDurationMs(summary.durationMs)}
          />
          <PostMetric
            label="turns"
            value={String(summary.characterTurnCount).padStart(2, "0")}
            hint={`${summary.turnCount} events`}
          />
          <PostMetric
            label="ttft"
            value={summary.ttftMs != null ? `${summary.ttftMs}ms` : "—"}
          />
          <PostMetric
            label="tokens"
            value={summary.tokens.toLocaleString()}
            hint={formatCost(summary.spent)}
          />
        </div>

        <div
          style={{ display: "flex", gap: "var(--space-12)", flexWrap: "wrap" }}
        >
          <button
            type="button"
            onClick={() => void copyDebugTrace()}
            disabled={copyStatus === "copying"}
            style={{
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
              cursor: copyStatus === "copying" ? "wait" : "pointer",
            }}
          >
            {copyStatus === "copying"
              ? "copying debug"
              : copyStatus === "copied"
                ? "debug copied"
                : "copy debug trace"}
          </button>
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
        {copyError ? (
          <div
            role="alert"
            style={{
              maxWidth: 760,
              color: DANGER,
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              lineHeight: "18px",
            }}
          >
            Debug copy failed: {copyError}
          </div>
        ) : null}
      </section>

      <aside
        style={{
          minHeight: 0,
          borderLeft: "1px solid var(--border)",
          background: "var(--material-card)",
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
            {summary.mode} · {traceRecords.length} traces · ended{" "}
            {formatClockTime(summary.endedAt)}
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
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-10)",
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
        background: "var(--material-card)",
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
  micInputDevices,
  selectedMicDeviceId,
  onMicDeviceChange,
  debugOpen,
  traceCount,
  onToggleDebug,
  onEnd,
}: {
  slug: string;
  title: string;
  mode: SandboxMode;
  onModeChange: (next: SandboxMode) => void;
  micInputDevices: MicInputDevice[];
  selectedMicDeviceId: string;
  onMicDeviceChange: (next: string) => void;
  debugOpen: boolean;
  traceCount: number;
  onToggleDebug: () => void;
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          flexShrink: 0,
        }}
      >
        <HeaderMicInputSelect
          devices={micInputDevices}
          selectedDeviceId={selectedMicDeviceId}
          onChange={onMicDeviceChange}
        />
        <button
          type="button"
          onClick={onEnd}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 30,
            padding: "0 14px",
            border:
              "1px solid color-mix(in srgb, var(--status-error) 34%, transparent)",
            borderRadius: "var(--radius-pill)",
            background: "color-mix(in srgb, var(--status-error) 10%, transparent)",
            color: DANGER,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ■ end
        </button>
        <HeaderDebugToggle
          active={debugOpen}
          traceCount={traceCount}
          onClick={onToggleDebug}
        />
      </div>
    </div>
  );
}

/* ── Toolbar sub-components ───────────────────────────────────── */

function HeaderMicInputSelect({
  devices,
  selectedDeviceId,
  onChange,
}: {
  devices: MicInputDevice[];
  selectedDeviceId: string;
  onChange: (next: string) => void;
}) {
  const hasSelectedDevice =
    selectedDeviceId && devices.some((device) => device.deviceId === selectedDeviceId);
  const selectedLabel =
    devices.find((device) => device.deviceId === selectedDeviceId)?.label ??
    "Saved input";
  const items: MenuItem<string>[] = [
    { value: "", label: "Default input", meta: "browser" },
    ...(selectedDeviceId && !hasSelectedDevice
      ? [{ value: selectedDeviceId, label: selectedLabel, meta: "saved" }]
      : []),
    ...devices.map((device) => ({
      value: device.deviceId,
      label: device.label,
      meta: "input",
    })),
  ];

  return (
    <Menu
      value={selectedDeviceId}
      onChange={onChange}
      items={items}
      ariaLabel="Microphone input"
      align="right"
      minWidth={220}
      triggerStyle={{
        height: 30,
        minWidth: 170,
        maxWidth: 220,
        padding: "0 11px",
        border:
          "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
        borderRadius: "var(--radius-pill)",
        background: "transparent",
        color: "var(--text-secondary)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
      renderTrigger={(current) => (
        <>
          <span style={{ color: "var(--text-tertiary)", flexShrink: 0 }}>
            mic
          </span>
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {current?.label ?? "Default input"}
          </span>
        </>
      )}
    />
  );
}

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
        minHeight: 30,
        border:
          "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
        borderRadius: "var(--radius-pill)",
        background: "transparent",
        overflow: "hidden",
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
        minHeight: 28,
        padding: "0 14px",
        background: active ? "var(--accent-fill)" : "transparent",
        border: "none",
        borderLeft: leftBorder
          ? "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)"
          : "none",
        color: active ? ACCENT : "var(--text-tertiary)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
        letterSpacing: "0.10em",
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

function HeaderDebugToggle({
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
        minHeight: 30,
        padding: "0 12px",
        border: active
          ? `1px solid ${ACCENT}`
          : "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
        borderRadius: "var(--radius-pill)",
        background: active
          ? "var(--accent-fill)"
          : "transparent",
        color: active ? ACCENT : "var(--text-tertiary)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <TraceIcon />
      diagnostics {traceCount > 0 ? traceCount : ""}
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

async function createSandboxSceneSession(input: {
  characterId: string;
  characterSlug: string;
  mode: SandboxMode;
  activeModel: string;
  ambienceSlug: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const sceneId = buildSandboxSceneId(input.characterSlug);
  const currentScene = buildInitialSandboxSceneSnapshot(
    sceneId,
    input.characterSlug,
    input.ambienceSlug,
  );
  const res = await fetch("/api/scene-sessions", {
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
    throw new Error(`scene-session create failed: ${detail.slice(0, 200)}`);
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
    `/api/scene-sessions/${encodeURIComponent(input.sessionId)}/orchestrate`,
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

function buildInitialSandboxSceneSnapshot(
  sceneId: string,
  characterSlug: string,
  // sm-sound: the character's bound sandbox bed (audio_assets slug) —
  // seeds SceneState.ambience so the session state matches what the
  // voice agent actually plays in char-… rooms. Null = silence.
  ambienceSlug: string | null,
) {
  return {
    version: 1 as const,
    sceneId,
    sceneState: {
      sceneId,
      beat: "The sandbox session is open and waiting for the user to begin.",
      presentCharacterSlugs: [characterSlug],
      ambience: ambienceSlug,
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

function buildSandboxPromptChunk(
  decision: OrchestratorDecision | null,
  character: SandboxCharacter,
): string | undefined {
  const inCharacterGuard =
    `Stay fully in character as ${character.title}. Do not refer to this as a role, ` +
    "voice profile, wiki page, prompt, or character description.";
  if (!decision) return inCharacterGuard;
  if (decision.action === "narrate") {
    const narration = decision.narration?.trim();
    if (!narration) return inCharacterGuard;
    return [
      inCharacterGuard,
      "Scene direction (orchestrator): narrate this response through the character voice.",
      decision.beat ? `Beat: ${decision.beat}` : "",
      decision.sceneCue ? `Scene cue: ${decision.sceneCue}` : "",
      `Speak exactly this narration, without adding anything: ${JSON.stringify(narration)}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (decision.action !== "speak") return inCharacterGuard;
  const parts = [
    inCharacterGuard,
    decision.beat ? `Scene direction (orchestrator): ${decision.beat}` : "",
    decision.sceneCue ? `Scene cue: ${decision.sceneCue}` : "",
    decision.beatLabel ? `Beat: ${decision.beatLabel}` : "",
  ].filter(Boolean);
  return `${parts.join("\n")}\n\n`;
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
  const res = await fetch(`/api/scene-sessions/${sessionId}`, {
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
  if (input.durationMs !== null)
    form.set("durationMs", String(input.durationMs));
  if (input.sampleRate) form.set("sampleRate", String(input.sampleRate));
  await fetch(`/api/scene-sessions/${input.sessionId}/audio`, {
    method: "POST",
    body: form,
  }).catch((err) => {
    console.warn(
      `[sandbox] ${input.direction} audio artifact upload failed`,
      err,
    );
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
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
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

function isSuspiciousStreamingTranscript(transcript: string): boolean {
  const normalized = transcript.trim();
  if (normalized.length <= STT_SUSPICIOUS_MAX_CHARS) return true;
  return normalized.split(/\s+/).filter(Boolean).length <= 1;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("clipboard copy was blocked");
}
