"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  encodeFloat32ToWav,
  MoshiStreamingSttSession,
} from "@/lib/moshi-client";
import { Trace, type TracePayload } from "@/lib/voice-trace";
import { VOICE_PIPELINE_CONFIG } from "@/lib/voice-pipeline-config";

const TTS_SAMPLE_RATE = 24000;

/* ── Speculation primitive ──────────────────────────────────────── */

type DoneInfo = {
  audioSamples?: number;
  durationMs?: number;
  firstAudioMs?: number;
  totalMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
  serverTrace?: TracePayload;
};

type SpeculationCommitCallbacks = {
  onToken: (delta: string) => void;
  onFirstAudio: (latencyMs: number) => void;
  onAudioFrame: (samples: Float32Array) => void;
  onDone: (info: DoneInfo) => void;
  onError: (message: string) => void;
};

type WorldSessionEventDraft = {
  id: string;
  turnId?: string | null;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type InputAudioCapture = {
  turnId: string;
  recorder: MediaRecorder;
  chunks: BlobPart[];
  startedAt: number;
  mimeType: string;
};

type OutputAudioCapture = {
  turnId: string;
  chunks: Float32Array[];
  startedAt: number;
};

type Speculation = {
  /** Aborts the in-flight SSE fetch and discards any buffered state. */
  abort: () => void;
  /** Snapshot of the user transcript at the moment we fired. */
  transcript: string;
  /**
   * Switch the speculation from buffering to playing mode. Drains all
   * buffered events into the callbacks immediately, then forwards future
   * events live. Idempotent-ish: a second commit replaces the live
   * callbacks but won't replay anything.
   */
  commit: (callbacks: SpeculationCommitCallbacks) => void;
};

function decodeBase64ToFloat32(base64: string): Float32Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Sliced into a fresh ArrayBuffer (not ArrayBufferLike) — Web Audio's
  // copyToChannel needs a concrete ArrayBuffer-backed Float32Array.
  const copy: ArrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Float32Array(copy);
}

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/**
 * Fire a /voice-stream call now and start buffering its SSE events. Caller
 * decides later (via `commit`) whether to actually play the result or drop
 * it (via `abort`). This is the primitive that lets us speculatively start
 * the LLM the moment VAD pause-prediction crosses the threshold, instead
 * of waiting the 500ms debounce.
 */
type SpeculationMode = "buffering" | "playing" | "aborted" | "errored";

function startSpeculation(args: {
  url: string;
  body: object;
  transcript: string;
}): Speculation {
  const abortController = new AbortController();
  // Wrapped in a holder so closures over `mode` see mutations across the
  // async fetch loop and the synchronous `commit` call. TS flow analysis
  // can't track raw `let` mutations across that boundary.
  const state: { mode: SpeculationMode } = { mode: "buffering" };
  // Same flow-analysis workaround as `state.mode`: TS can't see that this
  // mutates from inside `commit()` after the fetch loop has already started.
  const callbacksHolder: { value: SpeculationCommitCallbacks | null } = {
    value: null,
  };

  const tokenBuffer: string[] = [];
  const audioBuffer: Float32Array[] = [];
  let firstAudioBuffered: number | null = null;
  let doneBuffered: DoneInfo | null = null;
  let errorBuffered: string | null = null;
  let latestServerTrace: TracePayload | null = null;

  void (async () => {
    try {
      const res = await fetch(args.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.body),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        let detail = `HTTP ${res.status}`;
        try {
          const text = await res.text();
          const parsed = JSON.parse(text) as { error?: string };
          detail = parsed.error ?? text.slice(0, 200) ?? detail;
        } catch {
          /* leave detail */
        }
        const msg = `voice-stream rejected: ${detail}`;
        if (state.mode === "playing" && callbacksHolder.value) callbacksHolder.value.onError(msg);
        else errorBuffered = msg;
        state.mode = "errored";
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (state.mode === "aborted") break;
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
          let payload: unknown;
          try {
            payload = JSON.parse(dataLine);
          } catch {
            continue;
          }

          if (eventName === "token") {
            const d = payload as { delta?: string };
            if (d.delta) {
              if (state.mode === "playing" && callbacksHolder.value) callbacksHolder.value.onToken(d.delta);
              else tokenBuffer.push(d.delta);
            }
          } else if (eventName === "trace") {
            latestServerTrace = payload as TracePayload;
          } else if (eventName === "first-audio") {
            const d = payload as { latencyMs?: number };
            if (typeof d.latencyMs === "number") {
              if (state.mode === "playing" && callbacksHolder.value) callbacksHolder.value.onFirstAudio(d.latencyMs);
              else firstAudioBuffered = d.latencyMs;
            }
          } else if (eventName === "audio") {
            const d = payload as { pcm?: string };
            if (d.pcm) {
              const samples = decodeBase64ToFloat32(d.pcm);
              if (samples.length === 0) continue;
              if (state.mode === "playing" && callbacksHolder.value) callbacksHolder.value.onAudioFrame(samples);
              else audioBuffer.push(samples);
            }
          } else if (eventName === "done") {
            const d = payload as DoneInfo;
            if (!d.serverTrace && latestServerTrace) {
              d.serverTrace = latestServerTrace;
            }
            if (state.mode === "playing" && callbacksHolder.value) callbacksHolder.value.onDone(d);
            else doneBuffered = d;
          } else if (eventName === "error") {
            const d = payload as { message?: string };
            const msg = d.message ?? "voice-stream error";
            if (state.mode === "playing" && callbacksHolder.value) callbacksHolder.value.onError(msg);
            else errorBuffered = msg;
            state.mode = "errored";
          }
        }
      }
    } catch (err) {
      if (state.mode === "aborted") return;
      const msg = err instanceof Error ? err.message : "speculation fetch failed";
      if (state.mode === "playing" && callbacksHolder.value) callbacksHolder.value.onError(msg);
      else errorBuffered = msg;
      state.mode = "errored";
    }
  })();

  return {
    abort: () => {
      if (state.mode === "aborted") return;
      state.mode = "aborted";
      try {
        abortController.abort();
      } catch {
        /* ignore */
      }
    },
    transcript: args.transcript,
    commit: (callbacks) => {
      if (state.mode === "aborted") {
        callbacks.onError("speculation was aborted");
        return;
      }
      state.mode = "playing";
      callbacksHolder.value = callbacks;
      // Drain buffered events in their original order.
      for (const delta of tokenBuffer) callbacks.onToken(delta);
      tokenBuffer.length = 0;
      if (firstAudioBuffered !== null) callbacks.onFirstAudio(firstAudioBuffered);
      for (const samples of audioBuffer) callbacks.onAudioFrame(samples);
      audioBuffer.length = 0;
      if (errorBuffered) callbacks.onError(errorBuffered);
      else if (doneBuffered) callbacks.onDone(doneBuffered);
    },
  };
}

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  accent: "var(--accent-strong)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

type CharacterProp = {
  id: string;
  slug: string;
  title: string;
  image: string | null;
};

type Moment = { era: string; index: number };
type Scene = { activeEntities: string[]; location: string | null };

export type VoicePhase = "idle" | "warming" | "listening" | "thinking" | "speaking" | "error";

export type CharacterVoicePanelVoiceState = {
  active: boolean;
  phase: VoicePhase;
};

type StartupStepState = "idle" | "pending" | "ready" | "active" | "error" | "closed";

type VoiceStartupStatus = {
  micPermission: StartupStepState;
  micCapture: StartupStepState;
  worklet: StartupStepState;
  sttSocket: StartupStepState;
  context: StartupStepState;
  framesSent: number;
  lastFrameSentAt: number | null;
  lastFrameRms: number;
  lastFramePeak: number;
  lastFrameGain: number;
  lastFrameClippedSamples: number;
  sttLastMessageAt: number | null;
  sttStepCount: number;
  sttWordCount: number;
  contextTokens: number | null;
  contextElapsedMs: number | null;
  error: string | null;
};

type PipelineSegmentState = "idle" | "waiting" | "active" | "ready" | "aborted" | "error";

type VoicePipelineStatus = {
  currentTranscript: string;
  finalizedTranscript: string;
  speculation: "idle" | "buffering" | "committed" | "aborted";
  llm: {
    state: PipelineSegmentState;
    provider: string;
    model: string;
    tokenEvents: number;
    chars: number;
    firstTokenAt: number | null;
    lastTokenAt: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    preview: string;
    error: string | null;
  };
  tts: {
    state: PipelineSegmentState;
    audioFrames: number;
    audioSamples: number;
    firstAudioMs: number | null;
    lastAudioAt: number | null;
    durationMs: number | null;
    error: string | null;
  };
};

type PipelineSectionId = "stt" | "llm" | "tts";

export type CharacterVoicePanelHandle = {
  toggleVoiceMode: () => void;
  enterVoiceMode: () => void;
  exitVoiceMode: () => void;
};

type VoiceTurn = {
  id: string;
  user: string;
  assistant: string;
  status: "complete" | "error" | "interrupted";
  error: string | null;
  listenMs: number | null;
  replyMs: number | null;
  ttsFirstAudioMs: number | null;
  ttsDurationMs: number | null;
};

type ReplyContext = {
  turnId: string;
  userTranscript: string;
  listenMs: number | null;
  replyStartedAt: number;
  assistant: string;
  ttsFirstAudioMs: number | null;
};

type Props = {
  character: CharacterProp;
  moment: Moment | null;
  scene: Scene;
  /** LLM provider for per-turn voice replies (selected by the parent picker). */
  provider: "cerebras" | "anthropic";
  /** Model id for `provider` (e.g. "llama-3.3-70b" or "claude-haiku-4-5"). */
  model: string;
  tokenBudget: number;
  waveformSource?: "mic-and-tts" | "tts-only";
  onWaveformAudio?: (audio: {
    energy: number;
    bass: number;
    mid: number;
    high: number;
    peak: number;
    active: boolean;
  }) => void;
  onVoiceStateChange?: (state: CharacterVoicePanelVoiceState) => void;
};

const VAD_PAUSE_THRESHOLD = 0.5;
const VAD_AUTO_STOP_MS = 500;
const WORD_IDLE_FINALIZE_MS = 950;
const WORLD_EVENT_FLUSH_MS = 500;
const WORLD_EVENT_MAX_BATCH = 200;
const CAPTURE_RAW_STT_STEP_EVENTS = true;
// Kyutai STT emits text ~500ms after the corresponding audio. Words that
// arrive within this window of a finalize are residual from the previous
// utterance and must be dropped before they trigger a phantom barge-in.
const RESIDUAL_GRACE_MS = 700;

// Curator budget (used for the /voice-context call only — the per-turn
// voice-chat call doesn't run the curator). Provider/model are now picked
// by the parent's mode-aware dropdown and arrive as props.
const VOICE_MODE_TOKEN_BUDGET = 1500;

function createInitialStartupStatus(): VoiceStartupStatus {
  return {
    micPermission: "idle",
    micCapture: "idle",
    worklet: "idle",
    sttSocket: "idle",
    context: "idle",
    framesSent: 0,
    lastFrameSentAt: null,
    lastFrameRms: 0,
    lastFramePeak: 0,
    lastFrameGain: 1,
    lastFrameClippedSamples: 0,
    sttLastMessageAt: null,
    sttStepCount: 0,
    sttWordCount: 0,
    contextTokens: null,
    contextElapsedMs: null,
    error: null,
  };
}

function createInitialPipelineStatus(): VoicePipelineStatus {
  return {
    currentTranscript: "",
    finalizedTranscript: "",
    speculation: "idle",
    llm: {
      state: "idle",
      provider: "",
      model: "",
      tokenEvents: 0,
      chars: 0,
      firstTokenAt: null,
      lastTokenAt: null,
      inputTokens: null,
      outputTokens: null,
      preview: "",
      error: null,
    },
    tts: {
      state: "idle",
      audioFrames: 0,
      audioSamples: 0,
      firstAudioMs: null,
      lastAudioAt: null,
      durationMs: null,
      error: null,
    },
  };
}

function phaseLabel(phase: VoicePhase, voiceModeActive: boolean) {
  if (phase === "error") return "Voice setup failed";
  if (!voiceModeActive) return "Tap to enter voice mode";
  switch (phase) {
    case "warming":
      return "Warming up…";
    case "listening":
      return "Listening…";
    case "thinking":
      return "Thinking…";
    case "speaking":
      return "Speaking";
    default:
      return "Connecting…";
  }
}

function phaseColor(phase: VoicePhase, voiceModeActive: boolean) {
  if (phase === "error") return "#f87171";
  if (!voiceModeActive) return T.muted;
  switch (phase) {
    case "warming":
      return T.accent;
    case "listening":
      return "#ef4444";
    case "thinking":
      return T.accent;
    case "speaking":
      return "#4ade80";
    default:
      return T.muted;
  }
}

function startupStateColor(state: StartupStepState, activeColor = T.accent) {
  switch (state) {
    case "ready":
    case "active":
      return "#4ade80";
    case "pending":
      return activeColor;
    case "error":
    case "closed":
      return "#f87171";
    default:
      return T.muted;
  }
}

function startupStateLabel(state: StartupStepState) {
  switch (state) {
    case "ready":
      return "Ready";
    case "active":
      return "Active";
    case "pending":
      return "Starting";
    case "error":
      return "Error";
    case "closed":
      return "Closed";
    default:
      return "Waiting";
  }
}

function ageLabel(timestamp: number | null, now: number) {
  if (timestamp === null) return "never";
  const delta = Math.max(0, Math.round(now - timestamp));
  if (delta < 1000) return `${delta}ms ago`;
  return `${(delta / 1000).toFixed(delta < 10000 ? 1 : 0)}s ago`;
}

function StatusRow({
  label,
  state,
  detail,
  activeColor,
}: {
  label: string;
  state: StartupStepState;
  detail: string;
  activeColor?: string;
}) {
  const color = startupStateColor(state, activeColor);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "14px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 9,
        padding: "7px 0",
        borderBottom: "1px solid color-mix(in srgb, var(--border) 65%, transparent)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow:
            state === "pending" || state === "active"
              ? `0 0 8px ${color}`
              : "none",
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: T.fontBody,
            fontSize: 12,
            fontWeight: 600,
            color: T.fg,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 9.5,
            color: T.muted,
            letterSpacing: "0.03em",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {detail}
        </div>
      </div>
      <span
        style={{
          padding: "3px 7px",
          borderRadius: 5,
          border: `1px solid ${color}`,
          color,
          fontFamily: T.fontMono,
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {startupStateLabel(state)}
      </span>
    </div>
  );
}

function segmentStateColor(state: PipelineSegmentState) {
  switch (state) {
    case "active":
      return "#8CE7D2";
    case "ready":
      return "#4ade80";
    case "waiting":
      return "#FACC15";
    case "aborted":
      return "#FACC15";
    case "error":
      return "#f87171";
    default:
      return T.muted;
  }
}

function segmentStateLabel(state: PipelineSegmentState) {
  switch (state) {
    case "active":
      return "Live";
    case "ready":
      return "Done";
    case "waiting":
      return "Waiting";
    case "aborted":
      return "Aborted";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

function MetricCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "8px 9px",
        borderRadius: 7,
        border: `1px solid ${T.border}`,
        background: "color-mix(in srgb, var(--background) 38%, transparent)",
      }}
    >
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 8.5,
          color: T.muted,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          marginBottom: 4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 11,
          fontWeight: 700,
          color: T.fg,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SegmentPanel({
  title,
  state,
  subtitle,
  metrics,
  detail,
  collapsed,
  onToggle,
}: {
  title: string;
  state: PipelineSegmentState;
  subtitle: string;
  metrics: Array<{ label: string; value: string }>;
  detail: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const color = segmentStateColor(state);
  return (
    <section
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        background: "color-mix(in srgb, var(--panel) 88%, transparent)",
        padding: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          padding: "13px 14px",
          border: "none",
          borderBottom: collapsed ? "none" : `1px solid ${T.border}`,
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              color: T.muted,
              fontFamily: T.fontMono,
              fontSize: 12,
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              transition: "transform 120ms ease",
              flexShrink: 0,
            }}
          >
            ▾
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: T.fontMono,
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: T.fg,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontFamily: T.fontMono,
                fontSize: 9,
                color: T.muted,
                letterSpacing: "0.04em",
                marginTop: 3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {subtitle}
            </div>
          </div>
        </div>
        <span
          style={{
            padding: "3px 7px",
            borderRadius: 5,
            border: `1px solid ${color}`,
            color,
            fontFamily: T.fontMono,
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {segmentStateLabel(state)}
        </span>
      </button>
      {!collapsed ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 12,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 7,
            }}
          >
            {metrics.map((metric) => (
              <MetricCell key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>
          <div
            style={{
              minHeight: 34,
              padding: "8px 9px",
              borderRadius: 7,
              background: "color-mix(in srgb, var(--background) 30%, transparent)",
              color: T.muted,
              fontFamily: T.fontBody,
              fontSize: 11.5,
              lineHeight: "16px",
              overflow: "hidden",
            }}
          >
            {detail}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function VoiceDataFlowPanels({
  startupStatus,
  pipelineStatus,
  now,
  micPercent,
  vadPercent,
  collapsedSections,
  onToggleSection,
}: {
  startupStatus: VoiceStartupStatus;
  pipelineStatus: VoicePipelineStatus;
  now: number;
  micPercent: number;
  vadPercent: number;
  collapsedSections: Record<PipelineSectionId, boolean>;
  onToggleSection: (section: PipelineSectionId) => void;
}) {
  const transcript = pipelineStatus.currentTranscript || pipelineStatus.finalizedTranscript;
  const hearingAudio = startupStatus.lastFrameRms > 0.018 || startupStatus.lastFramePeak > 0.06;
  const sttAliveNoWords =
    startupStatus.framesSent > 20 &&
    startupStatus.sttStepCount > 0 &&
    startupStatus.sttWordCount === 0 &&
    hearingAudio;
  const sttState: PipelineSegmentState =
    startupStatus.sttSocket === "error" || startupStatus.micPermission === "error"
      ? "error"
      : sttAliveNoWords
        ? "waiting"
        : startupStatus.sttLastMessageAt !== null || startupStatus.framesSent > 0
          ? "active"
          : startupStatus.sttSocket === "ready"
            ? "waiting"
            : "idle";

  return (
    <div
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 10,
      }}
    >
      <SegmentPanel
        title="STT input"
        state={sttState}
        subtitle={`Mic -> AudioWorklet -> ${VOICE_PIPELINE_CONFIG.stt.label}`}
        collapsed={collapsedSections.stt}
        onToggle={() => onToggleSection("stt")}
        metrics={[
          { label: "Mic", value: `${micPercent}%` },
          { label: "Frames", value: `${startupStatus.framesSent}` },
          { label: "Steps", value: `${startupStatus.sttStepCount}` },
          { label: "Recognized words", value: `${startupStatus.sttWordCount}` },
          { label: "RMS", value: startupStatus.lastFrameRms.toFixed(4) },
          { label: "Peak", value: startupStatus.lastFramePeak.toFixed(3) },
          { label: "Input gain", value: `${startupStatus.lastFrameGain.toFixed(1)}x` },
          { label: "Clipped", value: `${startupStatus.lastFrameClippedSamples}` },
          { label: "Pause", value: `${vadPercent}%` },
          { label: "Signal", value: hearingAudio ? "speech/noise" : "quiet" },
          { label: "Last frame", value: ageLabel(startupStatus.lastFrameSentAt, now) },
          { label: "Last STT", value: ageLabel(startupStatus.sttLastMessageAt, now) },
        ]}
        detail={
          transcript
            ? `Transcript flow: ${transcript}`
	            : startupStatus.micPermission === "error"
	              ? "Mic permission is blocked, so no audio is reaching STT."
	              : sttAliveNoWords
	                ? `Audio and Step events are live, but ${VOICE_PIPELINE_CONFIG.stt.short} has not emitted Word events yet. The client is now sending float32 PCM and applying input gain; if this persists, the STT model is hearing the stream but not decoding speech.`
	              : "Waiting for speech. Audio frames show whether capture is actually reaching STT."
	        }
      />
      <SegmentPanel
        title="LLM provider"
        state={pipelineStatus.llm.state}
        subtitle={`${pipelineStatus.llm.provider || "provider"} -> ${pipelineStatus.llm.model || "model"}`}
        collapsed={collapsedSections.llm}
        onToggle={() => onToggleSection("llm")}
        metrics={[
          { label: "Speculation", value: pipelineStatus.speculation },
          { label: "Tokens", value: `${pipelineStatus.llm.tokenEvents}` },
          { label: "Chars", value: `${pipelineStatus.llm.chars}` },
          { label: "First token", value: ageLabel(pipelineStatus.llm.firstTokenAt, now) },
          { label: "Input tok", value: pipelineStatus.llm.inputTokens === null ? "—" : `${pipelineStatus.llm.inputTokens}` },
          { label: "Output tok", value: pipelineStatus.llm.outputTokens === null ? "—" : `${pipelineStatus.llm.outputTokens}` },
        ]}
        detail={
          pipelineStatus.llm.error ??
          (pipelineStatus.llm.preview
            ? `Reply stream: ${pipelineStatus.llm.preview}`
            : pipelineStatus.finalizedTranscript
              ? `Finalized input: ${pipelineStatus.finalizedTranscript}`
              : "No finalized utterance yet. This panel becomes live when /voice-stream starts.")
        }
      />
      <SegmentPanel
        title="TTS output"
        state={pipelineStatus.tts.state}
        subtitle={`LLM words -> ${VOICE_PIPELINE_CONFIG.tts.label} -> Web Audio`}
        collapsed={collapsedSections.tts}
        onToggle={() => onToggleSection("tts")}
        metrics={[
          { label: "Audio frames", value: `${pipelineStatus.tts.audioFrames}` },
          { label: "Samples", value: `${pipelineStatus.tts.audioSamples}` },
          { label: "First audio", value: pipelineStatus.tts.firstAudioMs === null ? "—" : `${pipelineStatus.tts.firstAudioMs}ms` },
          { label: "Last audio", value: ageLabel(pipelineStatus.tts.lastAudioAt, now) },
          { label: "Duration", value: pipelineStatus.tts.durationMs === null ? "—" : `${pipelineStatus.tts.durationMs}ms` },
          { label: "Queue", value: pipelineStatus.tts.audioSamples > 0 ? `${Math.round((pipelineStatus.tts.audioSamples / TTS_SAMPLE_RATE) * 1000)}ms` : "—" },
        ]}
        detail={
          pipelineStatus.tts.error ??
          (pipelineStatus.tts.audioFrames > 0
            ? "PCM frames are arriving from /voice-stream and being scheduled in Web Audio."
            : "Waiting for first audio frame. TTS starts once the LLM produces complete words.")
        }
      />
    </div>
  );
}

function VoiceReadinessPanel({
  status,
  now,
  voiceModeActive,
  phase,
  micPercent,
  vadPercent,
  isListening,
}: {
  status: VoiceStartupStatus;
  now: number;
  voiceModeActive: boolean;
  phase: VoicePhase;
  micPercent: number;
  vadPercent: number;
  isListening: boolean;
}) {
  if (!voiceModeActive && phase === "idle") return null;

  const framesState: StartupStepState =
    status.framesSent > 0
      ? "active"
      : status.sttSocket === "ready"
        ? "pending"
        : "idle";
  const serverState: StartupStepState =
    status.sttLastMessageAt !== null
      ? "active"
      : status.sttSocket === "ready"
        ? "pending"
        : "idle";
  const ready =
    status.micCapture === "active" &&
    status.worklet === "ready" &&
    status.sttSocket === "ready" &&
    status.framesSent > 0 &&
    status.sttLastMessageAt !== null &&
    status.context === "ready";
  const readyState: StartupStepState = ready
    ? "ready"
    : status.error
      ? "error"
      : "pending";

  return (
    <div
      style={{
        width: "min(100%, 420px)",
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        background: "color-mix(in srgb, var(--panel) 88%, transparent)",
        padding: "12px 14px 10px",
        boxShadow: "0 12px 34px rgba(0,0,0,0.18)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 10,
            fontWeight: 700,
            color: T.fg,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Startup pipeline
        </span>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 9.5,
            color: ready ? "#4ade80" : T.muted,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {ready ? "ready for speech" : "checking subsystems"}
        </span>
      </div>

      <StatusRow
        label="Microphone permission"
        state={status.micPermission}
        detail={
          status.micPermission === "error"
            ? status.error ?? "Browser denied mic access"
            : status.micPermission === "ready"
              ? "Browser accepted mic access"
              : status.micPermission === "pending"
                ? "Waiting for browser permission prompt"
                : "Not requested yet"
        }
      />
      <StatusRow
        label="Local audio capture"
        state={status.micCapture}
        detail={
          status.micCapture === "active"
            ? `Mic level ${micPercent}%`
            : status.micPermission === "error"
              ? "Blocked until microphone permission is granted"
              : "Waiting for mic stream"
        }
      />
      <StatusRow
        label="AudioWorklet loaded"
        state={status.worklet}
        detail={
          status.worklet === "ready"
            ? "PCM capture processor installed"
            : status.micPermission === "error"
              ? "Not loaded because mic setup failed"
              : "Waiting to load PCM capture processor"
        }
      />
      <StatusRow
        label="STT websocket"
        state={status.sttSocket}
        detail={
          status.sttSocket === "ready"
            ? `${VOICE_PIPELINE_CONFIG.stt.label} connection open`
            : status.sttSocket === "pending"
              ? `Connecting to ${VOICE_PIPELINE_CONFIG.stt.label}`
              : status.micPermission === "error"
                ? "Not opened because mic setup failed"
                : "Waiting to connect"
        }
      />
      <StatusRow
        label="Audio frames sent to STT"
        state={framesState}
        detail={`${status.framesSent} frames · last ${ageLabel(status.lastFrameSentAt, now)} · rms ${status.lastFrameRms.toFixed(4)} · peak ${status.lastFramePeak.toFixed(3)} · gain ${status.lastFrameGain.toFixed(1)}x`}
      />
      <StatusRow
        label="STT server responding"
        state={serverState}
        detail={`${status.sttStepCount} steps · ${status.sttWordCount} recognized words · last ${ageLabel(status.sttLastMessageAt, now)}`}
      />
      <StatusRow
        label="Character context cached"
        state={status.context}
        detail={
          status.contextTokens !== null
            ? `${status.contextTokens} tokens · curator ${status.contextElapsedMs ?? "?"}ms`
            : "Baseline promptChunk from /voice-context"
        }
      />
      <StatusRow
        label="Conversation readiness"
        state={readyState}
        detail={
          ready
            ? isListening
              ? `Listening · pause prediction ${vadPercent}%`
              : `Ready · current phase ${phase}`
            : status.micPermission === "error"
              ? "Grant microphone access, then retry voice mode"
              : status.error ?? "Waiting for all required signals"
        }
        activeColor="#4ade80"
      />
      {status.micPermission === "error" ? (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(248,113,113,0.3)",
            background: "rgba(248,113,113,0.08)",
            color: "#fecaca",
            fontFamily: T.fontBody,
            fontSize: 12,
            lineHeight: "17px",
          }}
        >
          Microphone access is blocked for this browser session. Use the
          browser permission control for this site to allow the mic, then tap
          the voice button again.
        </div>
      ) : null}
    </div>
  );
}

export const CharacterVoicePanel = forwardRef<CharacterVoicePanelHandle, Props>(function CharacterVoicePanel(
{
  character,
  moment,
  scene,
  provider,
  model,
  tokenBudget,
  waveformSource = "mic-and-tts",
  onWaveformAudio,
  onVoiceStateChange,
}: Props,
ref,
) {
  const allowMicWaveform = waveformSource === "mic-and-tts";
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentTurnTranscript, setCurrentTurnTranscript] = useState("");
  const [liveReply, setLiveReply] = useState("");
  const [vadPause, setVadPause] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [ttsFirstAudioMs, setTtsFirstAudioMs] = useState<number | null>(null);
  const [voiceTurns, setVoiceTurns] = useState<VoiceTurn[]>([]);
  const [transcriptPanelHidden, setTranscriptPanelHidden] = useState(false);
  const [startupStatus, setStartupStatus] = useState<VoiceStartupStatus>(() =>
    createInitialStartupStatus(),
  );
  const [pipelineStatus, setPipelineStatus] = useState<VoicePipelineStatus>(() =>
    createInitialPipelineStatus(),
  );
  const [collapsedPipelineSections, setCollapsedPipelineSections] = useState<
    Record<PipelineSectionId, boolean>
  >({
    stt: false,
    llm: false,
    tts: false,
  });
  const [statusNow, setStatusNow] = useState<number>(() =>
    typeof performance !== "undefined" ? performance.now() : Date.now(),
  );

  // Long-lived for the duration of voice mode.
  const sttSessionRef = useRef<MoshiStreamingSttSession | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  // Per-turn telemetry. Reset when a new turn starts (first non-residual Word
  // arrives), populated through the speculation/finalize/SSE flow, and printed
  // on `sse.done`. Lives in a ref so it survives re-renders without rebuilding.
  const turnTraceRef = useRef<Trace | null>(null);

  // Per-turn — recreated for each user utterance. The gainNode lets the
  // interrupt handler fade scheduled audio to silence in 60ms (clean
  // barge-in) without waiting for already-scheduled buffers to play out.
  // `abortActiveTurn` aborts the underlying speculation/SSE stream.
  const activeAudioRef = useRef<{
    gainNode: GainNode;
    fadeOutToZero: () => void;
    abortActiveTurn: () => void;
  } | null>(null);
  const browserTtsCancelRef = useRef<(() => void) | null>(null);
  const currentReplyContextRef = useRef<ReplyContext | null>(null);

  // Speculation that's been kicked off when VAD's pause-prediction crossed
  // threshold but we haven't yet confirmed the user is done. If user resumes
  // speech, we abort it. If pause-detect debounce confirms, we "commit" it
  // (claiming the in-flight LLM+TTS work that's already been racing).
  const speculationRef = useRef<Speculation | null>(null);

  // Pause-detection bookkeeping for the current listening window.
  const pauseTimerRef = useRef<number | null>(null);
  const idleFinalizeTimerRef = useRef<number | null>(null);
  const speechStartedRef = useRef(false);

  // Continuous-STT bookkeeping.
  const currentTurnWordsRef = useRef<string[]>([]);
  const turnFirstWordAtRef = useRef<number | null>(null);
  // Wall-clock of the last finalize. Words arriving within RESIDUAL_GRACE_MS
  // of this are dropped — they're trailing emissions from the just-finalized
  // utterance, not a new one. (Kyutai STT has a 500ms model delay.)
  const lastFinalizeAtRef = useRef<number | null>(null);
  const lastMicLevelRef = useRef(0);

  // Cached voice-mode context. Pre-fetched at enterVoiceMode in parallel
  // with the STT WS handshake; then sent with every per-turn voice-chat
  // request so the server can skip the curator step (~2s saved per turn).
  type VoiceContext = { promptChunk: string; characterTitle: string };
  const voiceContextRef = useRef<{
    promise: Promise<VoiceContext> | null;
    cached: VoiceContext | null;
  }>({ promise: null, cached: null });
  const worldSessionIdRef = useRef<string | null>(null);
  const worldSessionReadyRef = useRef<Promise<string | null> | null>(null);
  const currentInputTurnIdRef = useRef<string | null>(null);
  const worldEventQueueRef = useRef<WorldSessionEventDraft[]>([]);
  const worldEventFlushTimerRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCaptureRef = useRef<InputAudioCapture | null>(null);
  const outputAudioCaptureRef = useRef<OutputAudioCapture | null>(null);

  // Mirror of `phase` for synchronous reads inside async callbacks (avoids
  // stale-closure issues when WS events fire across renders).
  const phaseRef = useRef<VoicePhase>("idle");
  const voiceModeActiveRef = useRef(false);

  function clearIdleFinalizeTimer() {
    if (idleFinalizeTimerRef.current !== null) {
      window.clearTimeout(idleFinalizeTimerRef.current);
      idleFinalizeTimerRef.current = null;
    }
  }

  function scheduleIdleFinalize() {
    clearIdleFinalizeTimer();
    idleFinalizeTimerRef.current = window.setTimeout(() => {
      idleFinalizeTimerRef.current = null;
      if (!voiceModeActiveRef.current) return;
      if (!speechStartedRef.current) return;
      if (phaseRef.current === "thinking") return;
      finalizeCurrentTurn();
    }, WORD_IDLE_FINALIZE_MS);
  }

  useEffect(() => {
    return () => {
      void exitVoiceMode();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Catch tab close / hard refresh / mobile background. The React unmount
  // path doesn't fire on these, so without this the WS stays open against
  // the browser's TCP timeout and Modal holds the concurrency slot. We fire
  // a synchronous best-effort cleanup: WS close (with explicit 1000) and
  // mic-stream stop, both of which `session.stop()` does up-front.
  useEffect(() => {
    function onPageHide() {
      // Abort any in-flight reply so its SSE/WS to /voice-stream also closes.
      if (activeAudioRef.current) {
        try { activeAudioRef.current.abortActiveTurn(); } catch { /* ignore */ }
      }
      if (speculationRef.current) {
        try { speculationRef.current.abort(); } catch { /* ignore */ }
      }
      // Fire-and-forget — pagehide can't await, but stop() does the WS close
      // synchronously up front before any awaits.
      const session = sttSessionRef.current;
      if (session) {
        void session.stop();
      }
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    if (!voiceModeActive) return;
    const id = window.setInterval(() => {
      setStatusNow(performance.now());
    }, 500);
    return () => window.clearInterval(id);
  }, [voiceModeActive]);

  useEffect(() => {
    onVoiceStateChange?.({ active: voiceModeActive, phase });
  }, [onVoiceStateChange, phase, voiceModeActive]);

  function applyPhase(next: VoicePhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function ensureAudioContext(): AudioContext {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {
        /* the gesture-bound resume below should cover this */
      });
    }
    return audioContextRef.current;
  }

  function createWorldSession(): Promise<string | null> {
    const sessionId = crypto.randomUUID();
    worldSessionIdRef.current = sessionId;
    const initialScene = {
      activeEntities: scene.activeEntities,
      location: scene.location ?? null,
    };
    const promise = fetch("/api/world-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: sessionId,
        characterId: character.id,
        mode: "voice",
        initialMoment: moment,
        initialScene,
        currentMoment: moment,
        currentScene: initialScene,
        metadata: {
          source: "character-voice-panel",
          characterSlug: character.slug,
        },
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`world-sessions returned ${res.status}`);
        }
        return sessionId;
      })
      .catch((err) => {
        console.warn("[voice] world session create failed; continuing without persistence", err);
        if (worldSessionIdRef.current === sessionId) {
          worldSessionIdRef.current = null;
        }
        return null;
      });
    worldSessionReadyRef.current = promise;
    return promise;
  }

  function currentEventTurnId(): string | null {
    return currentInputTurnIdRef.current ?? currentReplyContextRef.current?.turnId ?? null;
  }

  function flushWorldEvents() {
    if (worldEventFlushTimerRef.current !== null) {
      window.clearTimeout(worldEventFlushTimerRef.current);
      worldEventFlushTimerRef.current = null;
    }
    const sessionId = worldSessionIdRef.current;
    if (!sessionId || worldEventQueueRef.current.length === 0) return;

    const events = worldEventQueueRef.current.splice(0, WORLD_EVENT_MAX_BATCH);
    const post = () =>
      fetch(`/api/world-sessions/${sessionId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
        keepalive: events.length <= 25,
      }).catch((err) => {
        console.warn("[voice] world event batch persist failed", err);
      });

    const ready = worldSessionReadyRef.current;
    if (ready) {
      void ready.then((confirmedSessionId) => {
        if (confirmedSessionId === sessionId) void post();
      });
    } else {
      void post();
    }

    if (worldEventQueueRef.current.length > 0) {
      worldEventFlushTimerRef.current = window.setTimeout(
        flushWorldEvents,
        WORLD_EVENT_FLUSH_MS,
      );
    }
  }

  function queueWorldEvent(
    type: string,
    source: string,
    payload: Record<string, unknown>,
    options: { turnId?: string | null; flushNow?: boolean } = {},
  ) {
    if (!worldSessionIdRef.current) return;
    worldEventQueueRef.current.push({
      id: crypto.randomUUID(),
      turnId: options.turnId === undefined ? currentEventTurnId() : options.turnId,
      type,
      source,
      payload,
      createdAt: new Date().toISOString(),
    });

    if (options.flushNow || worldEventQueueRef.current.length >= WORLD_EVENT_MAX_BATCH) {
      flushWorldEvents();
      return;
    }
    if (worldEventFlushTimerRef.current === null) {
      worldEventFlushTimerRef.current = window.setTimeout(
        flushWorldEvents,
        WORLD_EVENT_FLUSH_MS,
      );
    }
  }

  function preferredRecorderMimeType() {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
  }

  function uploadAudioArtifact(args: {
    turnId: string;
    direction: "input" | "output";
    blob: Blob;
    durationMs: number | null;
    sampleRate?: number | null;
  }) {
    const sessionId = worldSessionIdRef.current;
    if (!sessionId || args.blob.size === 0) return;
    const form = new FormData();
    form.set("file", args.blob, `${args.direction}-${args.turnId}.${args.direction === "output" ? "wav" : "webm"}`);
    form.set("direction", args.direction);
    form.set("turnId", args.turnId);
    if (args.durationMs !== null) form.set("durationMs", String(Math.round(args.durationMs)));
    if (args.sampleRate) form.set("sampleRate", String(args.sampleRate));
    void fetch(`/api/world-sessions/${sessionId}/audio`, {
      method: "POST",
      body: form,
    }).catch((err) => {
      console.warn(`[voice] ${args.direction} audio artifact upload failed`, err);
    });
  }

  function startInputAudioCapture(turnId: string) {
    if (inputAudioCaptureRef.current) return;
    const stream = micStreamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") return;
    try {
      const mimeType = preferredRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        console.warn("[voice] input MediaRecorder error", event);
      };
      inputAudioCaptureRef.current = {
        turnId,
        recorder,
        chunks,
        startedAt: performance.now(),
        mimeType: recorder.mimeType || mimeType || "audio/webm",
      };
      recorder.start(250);
      queueWorldEvent("audio.input.capture-started", "user", {
        mimeType: inputAudioCaptureRef.current.mimeType,
      }, { turnId });
    } catch (err) {
      console.warn("[voice] failed to start input audio capture", err);
    }
  }

  function stopInputAudioCapture(turnId: string, durationMs: number | null) {
    const capture = inputAudioCaptureRef.current;
    if (!capture || capture.turnId !== turnId) return;
    inputAudioCaptureRef.current = null;
    const finish = () => {
      const blob = new Blob(capture.chunks, { type: capture.mimeType });
      uploadAudioArtifact({
        turnId,
        direction: "input",
        blob,
        durationMs: durationMs ?? Math.round(performance.now() - capture.startedAt),
      });
      queueWorldEvent("audio.input.capture-stopped", "user", {
        mimeType: capture.mimeType,
        byteSize: blob.size,
        durationMs: durationMs ?? Math.round(performance.now() - capture.startedAt),
      }, { turnId, flushNow: true });
    };
    try {
      capture.recorder.onstop = finish;
      if (capture.recorder.state !== "inactive") capture.recorder.stop();
      else finish();
    } catch (err) {
      console.warn("[voice] failed to stop input audio capture", err);
      finish();
    }
  }

  function startOutputAudioCapture(turnId: string) {
    outputAudioCaptureRef.current = {
      turnId,
      chunks: [],
      startedAt: performance.now(),
    };
  }

  function appendOutputAudioFrame(turnId: string, samples: Float32Array) {
    const capture = outputAudioCaptureRef.current;
    if (!capture || capture.turnId !== turnId || samples.length === 0) return;
    capture.chunks.push(new Float32Array(samples));
  }

  function finishOutputAudioCapture(turnId: string, durationMs: number | null) {
    const capture = outputAudioCaptureRef.current;
    if (!capture || capture.turnId !== turnId) return;
    outputAudioCaptureRef.current = null;
    const sampleCount = capture.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (sampleCount === 0) return;
    const merged = new Float32Array(sampleCount);
    let offset = 0;
    for (const chunk of capture.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const wav = encodeFloat32ToWav(merged, TTS_SAMPLE_RATE);
    const wavBuffer = wav.buffer.slice(
      wav.byteOffset,
      wav.byteOffset + wav.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    const computedDurationMs = Math.round((sampleCount / TTS_SAMPLE_RATE) * 1000);
    uploadAudioArtifact({
      turnId,
      direction: "output",
      blob,
      durationMs: durationMs ?? computedDurationMs,
      sampleRate: TTS_SAMPLE_RATE,
    });
    queueWorldEvent("audio.output.capture-complete", "assistant", {
      mimeType: "audio/wav",
      sampleRate: TTS_SAMPLE_RATE,
      samples: sampleCount,
      byteSize: blob.size,
      durationMs: durationMs ?? computedDurationMs,
    }, { turnId, flushNow: true });
  }

  function endWorldSession(status = "ended") {
    flushWorldEvents();
    const sessionId = worldSessionIdRef.current;
    worldSessionIdRef.current = null;
    worldSessionReadyRef.current = null;
    currentInputTurnIdRef.current = null;
    if (!sessionId) return;
    void fetch(`/api/world-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
      keepalive: true,
    }).catch((err) => {
      console.warn("[voice] world session end failed", err);
    });
  }

  function persistWorldTurn(args: {
    turnId: string;
    status: VoiceTurn["status"];
    userTranscript: string;
    assistant: string;
    listenMs: number | null;
    replyMs: number | null;
    ttsFirstAudio: number | null;
    ttsDurationMs: number | null;
    trace?: Trace;
    extraMetadata?: Record<string, unknown>;
  }) {
    const sessionId = worldSessionIdRef.current;
    if (!sessionId) return;
    const traceJson = args.trace?.toJSON() ?? {};
    const latencySummary = args.trace?.summary() ?? {};
    void fetch(`/api/world-sessions/${sessionId}/turns/${args.turnId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputMode: "voice",
        userText: args.userTranscript,
        assistantText: args.assistant,
        provider,
        model,
        status: args.status,
        completedAt: new Date().toISOString(),
        audioMetrics: {
          listenMs: args.listenMs,
          replyMs: args.replyMs,
          ttsFirstAudioMs: args.ttsFirstAudio,
          ttsDurationMs: args.ttsDurationMs,
        },
        latencySummary,
        trace: traceJson,
        metadata: args.extraMetadata ?? {},
      }),
    }).catch((err) => {
      console.warn("[voice] world turn persist failed", err);
    });
  }

  async function enterVoiceMode() {
    if (voiceModeActiveRef.current) return;
    applyPhase("idle");
    setError(null);
    setCurrentTurnTranscript("");
    setLiveReply("");
    setVadPause(0);
    setMicLevel(0);
    setTtsFirstAudioMs(null);
    speechStartedRef.current = false;
    currentTurnWordsRef.current = [];
    if (currentInputTurnIdRef.current) {
      stopInputAudioCapture(currentInputTurnIdRef.current, null);
    }
    inputAudioCaptureRef.current = null;
    outputAudioCaptureRef.current = null;
    micStreamRef.current = null;
    turnFirstWordAtRef.current = null;
    lastFinalizeAtRef.current = null;
    lastMicLevelRef.current = 0;
    voiceContextRef.current = { promise: null, cached: null };
    currentInputTurnIdRef.current = null;
    const worldSessionPromise = createWorldSession();
    setStartupStatus({
      ...createInitialStartupStatus(),
      context: "pending",
    });
    setPipelineStatus(createInitialPipelineStatus());
    setStatusNow(performance.now());

    // Fire-and-forget context prefetch. Runs the curator once for this
    // session in parallel with mic + STT setup, so by the time the user
    // finishes their first sentence the cached context is ready and the
    // first reply can skip the ~2s curator step.
    voiceContextRef.current.promise = (async () => {
      const startedAt = performance.now();
      const worldSessionId = await worldSessionPromise;
      const res = await fetch(`/api/characters/${character.id}/voice-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: worldSessionId ?? undefined,
          moment,
          scene: {
            activeEntities: scene.activeEntities,
            location: scene.location ?? undefined,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`voice-context returned ${res.status}`);
      }
      const data = (await res.json()) as VoiceContext & {
        elapsedMs: number;
        tokensUsed: number;
      };
      console.log(
        `[voice] context cached in ${Math.round(performance.now() - startedAt)}ms (curator ${data.elapsedMs}ms, ${data.tokensUsed} tokens)`,
      );
      setStartupStatus((current) => ({
        ...current,
        context: "ready",
        contextTokens: data.tokensUsed,
        contextElapsedMs: data.elapsedMs,
      }));
      voiceContextRef.current.cached = {
        promptChunk: data.promptChunk,
        characterTitle: data.characterTitle,
      };
      return voiceContextRef.current.cached;
    })().catch((err) => {
      console.error("[voice] context prefetch failed", err);
      setStartupStatus((current) => ({
        ...current,
        context: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    });

    // (Modal TTS prewarm hack removed — Pocket TTS on Railway stays warm
    // via the audio-rt service's startup hook, so a no-cors browser probe
    // adds nothing.)

    // Create AudioContext under the user-gesture so playback can resume later
    // even after some idle time.
    ensureAudioContext();

    voiceModeActiveRef.current = true;
    setVoiceModeActive(true);
    applyPhase("warming");

    const session = new MoshiStreamingSttSession();
    sttSessionRef.current = session;

    // Surface the moment STT WS opens, so we can gate "listening" on it.
    let sttReadyResolve: () => void = () => {};
    const sttReadyPromise = new Promise<void>((resolve) => {
      sttReadyResolve = resolve;
    });

    try {
      await session.start({
        onMicPermissionPending: () => {
          setStartupStatus((current) => ({
            ...current,
            micPermission: "pending",
          }));
        },
        onMicCapture: (stream) => {
          micStreamRef.current = stream;
          setStartupStatus((current) => ({
            ...current,
            micPermission: "ready",
            micCapture: "active",
          }));
        },
        onWorkletLoading: () => {
          setStartupStatus((current) => ({
            ...current,
            worklet: "pending",
          }));
        },
        onWorkletReady: () => {
          setStartupStatus((current) => ({
            ...current,
            worklet: "ready",
          }));
        },
        onSocketConnecting: () => {
          setStartupStatus((current) => ({
            ...current,
            sttSocket: "pending",
          }));
        },
        onOpen: () => {
          console.log("[voice] STT WS open — STT ready");
          setStartupStatus((current) => ({
            ...current,
            sttSocket: "ready",
          }));
          sttReadyResolve();
        },
        onFrameSent: ({ framesSent, rms, peak, gain, clippedSamples }) => {
          setStartupStatus((current) => ({
            ...current,
            framesSent,
            lastFrameSentAt: performance.now(),
            lastFrameRms: rms,
            lastFramePeak: peak,
            lastFrameGain: gain,
            lastFrameClippedSamples: clippedSamples,
          }));
        },
        onServerMessage: (type) => {
          setStartupStatus((current) => ({
            ...current,
            sttLastMessageAt: performance.now(),
            sttStepCount: current.sttStepCount + (type === "Step" ? 1 : 0),
            sttWordCount: current.sttWordCount + (type === "Word" ? 1 : 0),
          }));
        },
        onWord: (text, startTime) => {
          const now = performance.now();
          const finalizedAt = lastFinalizeAtRef.current;
          const residualAge = finalizedAt !== null ? now - finalizedAt : null;

          // During `thinking` phase (between pause-detect and first audio),
          // we drop ALL Words. The user can't be barging in over audio that
          // hasn't started yet, and Kyutai STT often emits revised versions
          // of just-finalized words ("Hello," → "Hello?") that arrive in this
          // window — those residuals would otherwise trigger phantom turns.
          if (phaseRef.current === "thinking") {
            console.log(
              `[voice] thinking-phase Word dropped "${text}" (likely residual; barge-in is only allowed during speaking)`,
            );
            queueWorldEvent(
              "stt.word",
              "stt",
              {
                text,
                startTime,
                accepted: false,
                dropReason: "thinking-phase-residual",
                phase: phaseRef.current,
                micLevel: lastMicLevelRef.current,
                residualAgeMs: residualAge !== null ? Math.round(residualAge) : null,
                performanceNowMs: Math.round(now),
              },
              { flushNow: true },
            );
            return;
          }

          // During `listening` and `speaking`, also drop Words that fall
          // inside the residual grace window — they're tail emissions from
          // the previous turn's finalize.
          if (residualAge !== null && residualAge < RESIDUAL_GRACE_MS) {
            console.log(
              `[voice] residual Word dropped "${text}" (Δ=${Math.round(residualAge)}ms after finalize, phase=${phaseRef.current})`,
            );
            queueWorldEvent(
              "stt.word",
              "stt",
              {
                text,
                startTime,
                accepted: false,
                dropReason: "residual-grace-window",
                phase: phaseRef.current,
                micLevel: lastMicLevelRef.current,
                residualAgeMs: Math.round(residualAge),
                performanceNowMs: Math.round(now),
              },
              { flushNow: true },
            );
            return;
          }

          if (currentTurnWordsRef.current.length === 0) {
            currentInputTurnIdRef.current = crypto.randomUUID();
            turnFirstWordAtRef.current = now;
            // Open a fresh per-turn telemetry trace at first Word.
            turnTraceRef.current = new Trace();
            turnTraceRef.current.mark("turn.user-start", {
              word: text,
              turnId: currentInputTurnIdRef.current,
            });
            startInputAudioCapture(currentInputTurnIdRef.current);
            setPipelineStatus((current) => ({
              ...createInitialPipelineStatus(),
              speculation: current.speculation === "buffering" ? "buffering" : "idle",
              currentTranscript: text,
            }));
          }
          queueWorldEvent(
            "stt.word",
            "stt",
            {
              text,
              startTime,
              accepted: true,
              wordIndex: currentTurnWordsRef.current.length,
              phase: phaseRef.current,
              micLevel: lastMicLevelRef.current,
              residualAgeMs: residualAge !== null ? Math.round(residualAge) : null,
              performanceNowMs: Math.round(now),
            },
            { flushNow: true },
          );
          currentTurnWordsRef.current.push(text);
          const nextTranscript = currentTurnWordsRef.current.join(" ");
          setCurrentTurnTranscript(nextTranscript);
          setPipelineStatus((current) => ({
            ...current,
            currentTranscript: nextTranscript,
          }));
          speechStartedRef.current = true;
          scheduleIdleFinalize();

          console.log(
            `[voice] Word "${text}" (phase=${phaseRef.current}, mic=${lastMicLevelRef.current.toFixed(3)})`,
          );

          // New speech cancels any pending pause-detect.
          if (pauseTimerRef.current !== null) {
            window.clearTimeout(pauseTimerRef.current);
            pauseTimerRef.current = null;
          }

          // New speech also invalidates any speculative LLM call we fired
          // when pause-prediction briefly crossed the threshold — the user
          // wasn't actually done. Abort it so the server tears down the
          // wasted Cerebras + TTS work.
          if (speculationRef.current) {
            console.log(
              `[voice] speculation aborted (user resumed with "${text}")`,
            );
            speculationRef.current.abort();
            speculationRef.current = null;
            setPipelineStatus((current) => ({
              ...current,
              speculation: "aborted",
              llm: {
                ...current.llm,
                state: current.llm.state === "idle" ? "idle" : "aborted",
                error: "Speculation aborted because the user resumed speaking.",
              },
              tts: {
                ...current.tts,
                state: current.tts.state === "idle" ? "idle" : "aborted",
                error: "Pending TTS stream was aborted before commit.",
              },
            }));
          }

          // Barge-in: a Word during speaking phase means the user is talking
          // over the character. Cancel the in-flight reply; the new word is
          // already in the current-turn buffer for the next reply.
          // (Words during `thinking` were already dropped above as residuals,
          // so we only need to check for the speaking case here.)
          if (phaseRef.current === "speaking") {
            console.log(
              `[voice] BARGE-IN triggered by "${text}" during speaking`,
            );
            interruptCurrentReply();
          }
        },
        onPausePrediction: (p) => {
          const stepAt = performance.now();
          setVadPause(p);
          if (CAPTURE_RAW_STT_STEP_EVENTS) {
            queueWorldEvent("stt.step", "stt", {
              pausePrediction: p,
              phase: phaseRef.current,
              micLevel: lastMicLevelRef.current,
              speechStarted: speechStartedRef.current,
              wordCountInTurn: currentTurnWordsRef.current.length,
              threshold: VAD_PAUSE_THRESHOLD,
              aboveThreshold: p > VAD_PAUSE_THRESHOLD,
              performanceNowMs: Math.round(stepAt),
            });
          }
          // Pause auto-finalize only fires while listening (not during
          // thinking/speaking).
          if (phaseRef.current !== "listening") return;
          if (!speechStartedRef.current) return;

          if (p > VAD_PAUSE_THRESHOLD) {
            if (pauseTimerRef.current === null) {
              pauseTimerRef.current = window.setTimeout(() => {
                pauseTimerRef.current = null;
                finalizeCurrentTurn();
              }, VAD_AUTO_STOP_MS);

              // Speculative trigger: the moment pause-prediction crosses
              // threshold (i.e. the moment we'd START the debounce), kick
              // off the LLM call. If the user actually resumes speaking,
              // the onWord handler aborts it. If they don't, the debounce
              // confirms ~500ms later and finalizeCurrentTurn commits the
              // speculation — which has been racing against the debounce
              // and is typically already producing audio by then.
              maybeFireSpeculation();
            }
          } else if (pauseTimerRef.current !== null) {
            window.clearTimeout(pauseTimerRef.current);
            pauseTimerRef.current = null;
            // We deliberately DON'T abort speculation here — pause-prediction
            // dipping below threshold can be transient (a breath); only an
            // actual Word arrival means the user really resumed speaking.
          }
        },
        onLevel: (rms) => {
          lastMicLevelRef.current = rms;
          setMicLevel(rms);
          if (allowMicWaveform && phaseRef.current !== "speaking") {
            const energy = Math.max(0, Math.min(1, rms * 8.5));
            onWaveformAudio?.({
              energy,
              bass: energy * 0.82,
              mid: energy * 0.94,
              high: energy * 0.64,
              peak: energy,
              active: voiceModeActiveRef.current,
            });
          }
        },
        onError: (message) => {
          setStartupStatus((current) => ({
            ...current,
            sttSocket: "error",
            error: message,
          }));
          setError(message);
          applyPhase("error");
        },
        onClose: () => {
          setStartupStatus((current) => ({
            ...current,
            sttSocket: voiceModeActiveRef.current ? "closed" : current.sttSocket,
          }));
        },
      });

      // Block the transition to "listening" until all three prewarms have
      // signalled ready: STT WebSocket open, TTS Modal container responding,
      // and curator/voice-context cached. This is the "Warming up…" state
      // the user sees on the mic button until the system is hot.
      const warmStart = performance.now();
      const contextSettled = voiceContextRef.current.promise
        ? voiceContextRef.current.promise
            .then(() => undefined)
            .catch(() => undefined)
        : Promise.resolve(undefined);
      await Promise.all([sttReadyPromise, contextSettled]);
      console.log(
        `[voice] all prewarms complete in ${Math.round(performance.now() - warmStart)}ms`,
      );

      // If the user backed out of voice mode while we were warming, don't
      // silently transition them back into listening.
      if (!voiceModeActiveRef.current) return;

      applyPhase("listening");
    } catch (startError) {
      const message =
        startError instanceof Error ? startError.message : "Failed to start mic.";
      setStartupStatus((current) => ({
        ...current,
        micPermission:
          current.micPermission === "pending" || current.micPermission === "idle"
            ? "error"
            : current.micPermission,
        error: message,
      }));
      setError(message);
      applyPhase("error");
      voiceModeActiveRef.current = false;
      setVoiceModeActive(false);
      sttSessionRef.current = null;
    }
  }

  async function exitVoiceMode() {
    voiceModeActiveRef.current = false;

    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    clearIdleFinalizeTimer();
    if (browserTtsCancelRef.current) {
      browserTtsCancelRef.current();
      browserTtsCancelRef.current = null;
    }

    // Cancel any in-flight reply (fade audio + abort SSE).
    if (activeAudioRef.current) {
      activeAudioRef.current.fadeOutToZero();
      activeAudioRef.current.abortActiveTurn();
      activeAudioRef.current = null;
    }
    setPipelineStatus((current) => ({
      ...current,
      speculation: "aborted",
      llm: {
        ...current.llm,
        state: current.llm.state === "idle" ? "idle" : "aborted",
        error: "Interrupted by user barge-in.",
      },
      tts: {
        ...current.tts,
        state: current.tts.state === "idle" ? "idle" : "aborted",
        error: "Audio faded out because the user barged in.",
      },
    }));
    // Discard any pending speculation.
    if (speculationRef.current) {
      speculationRef.current.abort();
      speculationRef.current = null;
    }
    if (currentReplyContextRef.current) {
      const ctx = currentReplyContextRef.current;
      const trace = turnTraceRef.current;
      trace?.mark("turn.interrupted", { reason: "voice-mode-exit" });
      persistWorldTurn({
        turnId: ctx.turnId,
        status: "interrupted",
        userTranscript: ctx.userTranscript,
        assistant: ctx.assistant,
        listenMs: ctx.listenMs,
        replyMs: Math.round(performance.now() - ctx.replyStartedAt),
        ttsFirstAudio: ctx.ttsFirstAudioMs,
        ttsDurationMs: null,
        trace: trace ?? undefined,
        extraMetadata: { reason: "voice-mode-exit" },
      });
      turnTraceRef.current = null;
    }
    currentReplyContextRef.current = null;

    // Stop the long-lived STT session.
    if (sttSessionRef.current) {
      await sttSessionRef.current.stop();
      sttSessionRef.current = null;
    }

    // Close audio context.
    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {
        /* ignore */
      }
      audioContextRef.current = null;
    }

    // Reset state.
    currentTurnWordsRef.current = [];
    turnFirstWordAtRef.current = null;
    lastFinalizeAtRef.current = null;
    lastMicLevelRef.current = 0;
    voiceContextRef.current = { promise: null, cached: null };
    endWorldSession("ended");
    speechStartedRef.current = false;
    setStartupStatus(createInitialStartupStatus());
    setPipelineStatus(createInitialPipelineStatus());
    setStatusNow(performance.now());
    setCurrentTurnTranscript("");
    setLiveReply("");
    setMicLevel(0);
    setVadPause(0);
    setTtsFirstAudioMs(null);
    onWaveformAudio?.({
      energy: 0,
      bass: 0,
      mid: 0,
      high: 0,
      peak: 0,
      active: false,
    });
    setVoiceModeActive(false);
    applyPhase("idle");
  }

  /**
   * Fire a speculative LLM call with the current in-progress transcript.
   * Called from onPausePrediction when VAD first crosses threshold — if the
   * user actually went silent, by the time the debounce confirms, this call
   * has already had ~500ms head-start and is usually mid-stream.
   *
   * Only fires if we have cached context — without context, the speculation
   * would be lower quality, and the round-trip to /voice-context would
   * defeat the latency win anyway. The non-speculative finalize path awaits
   * context if needed.
   */
  function maybeFireSpeculation() {
    if (speculationRef.current) return;
    const cachedContext = voiceContextRef.current.cached;
    if (!cachedContext) return;
    const transcript = currentTurnWordsRef.current.join(" ").trim();
    if (!transcript) return;

    const history = voiceTurns
      .filter((t) => t.status === "complete")
      .flatMap((t) => [
        { role: "user" as const, content: t.user },
        { role: "assistant" as const, content: t.assistant },
      ]);

    console.log(
      `[voice] speculation fired: "${transcript}" (waiting for debounce)`,
    );

    turnTraceRef.current?.mark("vad.threshold-crossed");
    turnTraceRef.current?.mark("voice-stream.posted", { provider, model });
    setPipelineStatus((current) => ({
      ...current,
      speculation: "buffering",
      llm: {
        ...current.llm,
        state: "waiting",
        provider,
        model,
        error: null,
      },
      tts: {
        ...current.tts,
        state: "waiting",
        error: null,
      },
    }));

    speculationRef.current = startSpeculation({
      url: `/api/characters/${character.id}/voice-stream`,
      body: {
        sessionId: worldSessionIdRef.current ?? undefined,
        turnId: currentInputTurnIdRef.current ?? undefined,
        promptChunk: cachedContext.promptChunk,
        message: transcript,
        history,
        provider,
        model,
      },
      transcript,
    });
  }

  function finalizeCurrentTurn() {
    clearIdleFinalizeTimer();
    flushWorldEvents();
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }

    const transcript = currentTurnWordsRef.current.join(" ").trim();
    if (!transcript) {
      speechStartedRef.current = false;
      if (currentInputTurnIdRef.current) {
        stopInputAudioCapture(currentInputTurnIdRef.current, null);
      }
      // No transcript at finalize → can't be a real turn. Discard any
      // speculation that may have fired on a transient pause-prediction.
      if (speculationRef.current) {
        speculationRef.current.abort();
        speculationRef.current = null;
        currentInputTurnIdRef.current = null;
        setPipelineStatus((current) => ({
          ...current,
          speculation: "aborted",
        }));
      }
      return;
    }
    const listenMs = turnFirstWordAtRef.current
      ? Math.round(performance.now() - turnFirstWordAtRef.current)
      : null;
    const finalizedTurnId = currentInputTurnIdRef.current;
    if (finalizedTurnId) {
      stopInputAudioCapture(finalizedTurnId, listenMs);
    }
    turnTraceRef.current?.mark("turn.finalized", { listenMs });
    setPipelineStatus((current) => ({
      ...current,
      finalizedTranscript: transcript,
      currentTranscript: "",
      llm: {
        ...current.llm,
        state: current.llm.state === "idle" ? "waiting" : current.llm.state,
        provider,
        model,
        error: null,
      },
      tts: {
        ...current.tts,
        state: current.tts.state === "idle" ? "waiting" : current.tts.state,
        error: null,
      },
    }));

    // Snapshot, clear buffer for the next turn (which may start mid-reply
    // via barge-in, or after the reply completes).
    currentTurnWordsRef.current = [];
    turnFirstWordAtRef.current = null;
    setCurrentTurnTranscript("");
    speechStartedRef.current = false;
    setVadPause(0);

    // Mark the finalize moment so trailing Words from this utterance get
    // filtered out instead of triggering a phantom next turn / barge-in.
    lastFinalizeAtRef.current = performance.now();

    // Also drop the in-session word buffer. Moshi-server keeps its own
    // streaming context, so subsequent Words are naturally a new utterance.
    sttSessionRef.current?.resetTranscript();

    // If we have a matching speculation in flight, claim it. Otherwise
    // discard any stale speculation and fire fresh.
    const spec = speculationRef.current;
    speculationRef.current = null;
    if (spec && spec.transcript === transcript) {
      console.log(`[voice] committing speculation (transcript match)`);
      void runReplyAndSpeak(transcript, listenMs, spec);
      return;
    }
    if (spec) {
      console.log(
        `[voice] discarding stale speculation (spec="${spec.transcript}", final="${transcript}")`,
      );
      spec.abort();
      setPipelineStatus((current) => ({
        ...current,
        speculation: "aborted",
      }));
    }
    void runReplyAndSpeak(transcript, listenMs);
  }

  function interruptCurrentReply() {
    const ctx = currentReplyContextRef.current;
    flushWorldEvents();
    if (browserTtsCancelRef.current) {
      browserTtsCancelRef.current();
      browserTtsCancelRef.current = null;
    }

    // Fade scheduled audio to silence (~60ms) then abort the underlying
    // speculation/SSE stream. The server detects the abort and tears down
    // the TTS WS, so we don't keep generating audio for a cancelled turn.
    if (activeAudioRef.current) {
      activeAudioRef.current.fadeOutToZero();
      activeAudioRef.current.abortActiveTurn();
      activeAudioRef.current = null;
    }

    // Save the partial assistant utterance as an interrupted turn so it's
    // visible in the history, then clear the context so the in-flight
    // runReplyAndSpeak knows it has been handled.
    if (ctx) {
      const trace = turnTraceRef.current;
      trace?.mark("turn.interrupted");
      finishOutputAudioCapture(ctx.turnId, null);
      persistWorldTurn({
        turnId: ctx.turnId,
        status: "interrupted",
        userTranscript: ctx.userTranscript,
        assistant: ctx.assistant,
        listenMs: ctx.listenMs,
        replyMs: Math.round(performance.now() - ctx.replyStartedAt),
        ttsFirstAudio: ctx.ttsFirstAudioMs,
        ttsDurationMs: null,
        trace: trace ?? undefined,
        extraMetadata: { reason: "barge-in-or-exit" },
      });
      setVoiceTurns((current) => [
        ...current,
        {
          id: ctx.turnId,
          user: ctx.userTranscript,
          assistant: ctx.assistant,
          status: "interrupted",
          error: null,
          listenMs: ctx.listenMs,
          replyMs: Math.round(performance.now() - ctx.replyStartedAt),
          ttsFirstAudioMs: ctx.ttsFirstAudioMs,
          ttsDurationMs: null,
        },
      ]);
      currentReplyContextRef.current = null;
      turnTraceRef.current = null;
    }

    setLiveReply("");
    setTtsFirstAudioMs(null);
    applyPhase("listening");
  }

  async function runReplyAndSpeak(
    userTranscript: string,
    listenMs: number | null,
    preFired?: Speculation,
  ) {
    applyPhase("thinking");
    setLiveReply("");
    setTtsFirstAudioMs(null);

    const turnId = currentInputTurnIdRef.current ?? crypto.randomUUID();
    currentInputTurnIdRef.current = null;
    startOutputAudioCapture(turnId);
    let assistant = "";
    let replyMs: number | null = null;
    let ttsFirstAudio: number | null = null;
    let ttsDurationMs: number | null = null;
    let streamedAnyAudio = false;
    const replyStartedAt = performance.now();

    currentReplyContextRef.current = {
      turnId,
      userTranscript,
      listenMs,
      replyStartedAt,
      assistant: "",
      ttsFirstAudioMs: null,
    };

    console.log(
      `[voice] turn ${turnId.slice(0, 8)} starts: "${userTranscript}"${preFired ? " (committing speculation)" : ""}`,
    );

    // Prepare per-turn audio scheduling. Per-turn GainNode means barge-in
    // can fade scheduled buffers cleanly without affecting the next turn.
    const audioContext = ensureAudioContext();
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1;
    const analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.24;
    gainNode.connect(analyserNode);
    analyserNode.connect(audioContext.destination);
    let nextStartTime = audioContext.currentTime;
    let analyserRaf = 0;
    let scheduledSourceCount = 0;
    let endedSourceCount = 0;
    let playbackAborted = false;
    let playbackDrainResolve: (() => void) | null = null;
    let firstPlaybackStartMarked = false;
    const playbackStartTimers = new Set<number>();

    const clearPlaybackStartTimers = () => {
      for (const timer of playbackStartTimers) {
        window.clearTimeout(timer);
      }
      playbackStartTimers.clear();
    };

    const resolvePlaybackDrainIfReady = () => {
      if (!playbackDrainResolve) return;
      if (playbackAborted || endedSourceCount >= scheduledSourceCount) {
        playbackDrainResolve();
        playbackDrainResolve = null;
      }
    };

    const waitForQueuedPlayback = async () => {
      if (playbackAborted || scheduledSourceCount === 0) return;
      if (endedSourceCount >= scheduledSourceCount) return;

      await new Promise<void>((resolve) => {
        let fallbackTimer = 0;
        const finish = () => {
          if (fallbackTimer !== 0) {
            window.clearTimeout(fallbackTimer);
            fallbackTimer = 0;
          }
          if (playbackDrainResolve === finish) playbackDrainResolve = null;
          resolve();
        };

        playbackDrainResolve = finish;
        const remainingMs = Math.max(
          0,
          Math.ceil((nextStartTime - audioContext.currentTime) * 1000),
        );
        fallbackTimer = window.setTimeout(finish, remainingMs + 300);
        resolvePlaybackDrainIfReady();
      });
    };

    const emitTtsMetrics = () => {
      if (!onWaveformAudio || phaseRef.current !== "speaking") return;
      const freq = new Uint8Array(analyserNode.frequencyBinCount);
      const time = new Uint8Array(analyserNode.fftSize);
      analyserNode.getByteFrequencyData(freq);
      analyserNode.getByteTimeDomainData(time);

      let rms = 0;
      for (let i = 0; i < time.length; i += 1) {
        const v = (time[i] - 128) / 128;
        rms += v * v;
      }
      rms = Math.sqrt(rms / time.length);

      const n = freq.length;
      const bEnd = Math.floor(n * 0.16);
      const mEnd = Math.floor(n * 0.56);
      let bass = 0;
      let mid = 0;
      let high = 0;
      for (let i = 0; i < n; i += 1) {
        const v = freq[i] / 255;
        if (i < bEnd) bass += v;
        else if (i < mEnd) mid += v;
        else high += v;
      }
      bass /= Math.max(1, bEnd);
      mid /= Math.max(1, mEnd - bEnd);
      high /= Math.max(1, n - mEnd);
      const spectral = (bass + mid + high) / 3;
      const energy = Math.max(0, Math.min(1, rms * 6.4 + spectral * 1.2));

      onWaveformAudio({
        energy,
        bass,
        mid,
        high,
        peak: Math.max(0, Math.min(1, energy * 0.85 + high * 0.25)),
        active: true,
      });

      analyserRaf = window.requestAnimationFrame(emitTtsMetrics);
    };

    const fadeOutToZero = () => {
      playbackAborted = true;
      const now = audioContext.currentTime;
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.06);
      } catch {
        /* ignore */
      }
      resolvePlaybackDrainIfReady();
    };

    const scheduleAudio = (samples: Float32Array) => {
      try {
        if (samples.length === 0) return;
        streamedAnyAudio = true;
        const audioBuffer = audioContext.createBuffer(
          1,
          samples.length,
          TTS_SAMPLE_RATE,
        );
        // Web Audio's copyToChannel requires `Float32Array<ArrayBuffer>` (a
        // narrower type than the generic-less `Float32Array` we receive).
        // Our samples are already ArrayBuffer-backed (decodeBase64ToFloat32
        // copies into a fresh ArrayBuffer); the cast is just satisfying TS.
        audioBuffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode);
        const now = audioContext.currentTime;
        const startAt = Math.max(now, nextStartTime);
        const durationSeconds = samples.length / TTS_SAMPLE_RATE;
        const endAt = startAt + durationSeconds;
        source.onended = () => {
          endedSourceCount += 1;
          resolvePlaybackDrainIfReady();
        };
        source.start(startAt);
        scheduledSourceCount += 1;
        nextStartTime = endAt;

        if (!firstPlaybackStartMarked) {
          firstPlaybackStartMarked = true;
          const delayMs = Math.max(
            0,
            Math.ceil((startAt - audioContext.currentTime) * 1000),
          );
          const timer = window.setTimeout(() => {
            playbackStartTimers.delete(timer);
            turnTraceRef.current?.mark("audio.first-played", {
              scheduledDelayMs: delayMs,
            });
          }, delayMs);
          playbackStartTimers.add(timer);
        }
      } catch (err) {
        console.error("[voice] failed to schedule audio frame", err);
      }
    };

    const playFallbackTts = async (
      text: string,
    ): Promise<{ ok: boolean; error?: string; durationMs?: number }> => {
      const trimmed = text.trim();
      if (!trimmed) return { ok: false, error: "Fallback text was empty." };

      const speakWithBrowserTts = async (): Promise<{
        ok: boolean;
        error?: string;
        durationMs?: number;
      }> => {
        if (
          typeof window === "undefined" ||
          typeof SpeechSynthesisUtterance === "undefined" ||
          !("speechSynthesis" in window)
        ) {
          return {
            ok: false,
            error: "Browser speech synthesis is unavailable.",
          };
        }

        const synth = window.speechSynthesis;
        try {
          synth.cancel();
        } catch {
          /* ignore */
        }

        return await new Promise((resolve) => {
          const utterance = new SpeechSynthesisUtterance(trimmed);
          utterance.lang = "en-US";
          utterance.rate = 0.95;
          utterance.pitch = 0.9;
          utterance.volume = 1;

          const voices = synth.getVoices();
          const preferredVoice =
            voices.find((v) => /alex|daniel|fred|thomas/i.test(v.name)) ??
            voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
            null;
          if (preferredVoice) {
            utterance.voice = preferredVoice;
          }

          let settled = false;
          let burst = 0;
          let raf = 0;
          const startedAt = performance.now();

          const finish = (result: { ok: boolean; error?: string; durationMs?: number }) => {
            if (settled) return;
            settled = true;
            if (raf !== 0) {
              window.cancelAnimationFrame(raf);
              raf = 0;
            }
            browserTtsCancelRef.current = null;
            onWaveformAudio?.({
              energy: 0,
              bass: 0,
              mid: 0,
              high: 0,
              peak: 0,
              active: false,
            });
            resolve(result);
          };

          const pumpWave = () => {
            if (settled) return;
            burst *= 0.84;
            const t = performance.now() * 0.01;
            const energy = Math.max(
              0.05,
              Math.min(0.82, 0.18 + Math.abs(Math.sin(t)) * 0.24 + burst * 0.56),
            );
            onWaveformAudio?.({
              energy,
              bass: Math.max(0, Math.min(1, energy * 0.82)),
              mid: Math.max(0, Math.min(1, energy * 0.96)),
              high: Math.max(0, Math.min(1, energy * 0.64 + burst * 0.2)),
              peak: Math.max(0, Math.min(1, energy * 0.9 + burst * 0.24)),
              active: true,
            });
            raf = window.requestAnimationFrame(pumpWave);
          };

          browserTtsCancelRef.current = () => {
            try {
              synth.cancel();
            } catch {
              /* ignore */
            }
            finish({
              ok: false,
              error: "Browser speech cancelled.",
              durationMs: Math.round(performance.now() - startedAt),
            });
          };

          utterance.onstart = () => {
            if (phaseRef.current === "thinking") {
              applyPhase("speaking");
            }
            if (ttsFirstAudio === null) {
              const latencyMs = Math.round(performance.now() - replyStartedAt);
              ttsFirstAudio = latencyMs;
              setTtsFirstAudioMs(latencyMs);
              if (currentReplyContextRef.current?.turnId === turnId) {
                currentReplyContextRef.current.ttsFirstAudioMs = latencyMs;
              }
            }
            pumpWave();
          };

          utterance.onboundary = () => {
            burst = Math.min(1, burst + 0.42);
          };

          utterance.onend = () => {
            finish({
              ok: true,
              durationMs: Math.round(performance.now() - startedAt),
            });
          };

          utterance.onerror = (event) => {
            finish({
              ok: false,
              error: `Browser speech failed: ${event.error || "unknown error"}`,
              durationMs: Math.round(performance.now() - startedAt),
            });
          };

          try {
            synth.speak(utterance);
          } catch (err) {
            finish({
              ok: false,
              error: err instanceof Error ? err.message : "Browser speech threw.",
              durationMs: Math.round(performance.now() - startedAt),
            });
          }
        });
      };

      const response = await fetch("/api/audio/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        audioBase64?: string;
        mimeType?: string;
        provider?: string;
        error?: string;
        details?: string[];
      };

      if (!response.ok || !payload.audioBase64 || !payload.mimeType) {
        const detail =
          payload.error ??
          (Array.isArray(payload.details) ? payload.details.join(" | ") : "") ??
          `HTTP ${response.status}`;
        console.warn(
          "[voice] fallback /api/audio/speak failed",
          response.status,
          detail,
        );
        return await speakWithBrowserTts();
      }

      const encoded = decodeBase64ToArrayBuffer(payload.audioBase64);
      const decoded = await audioContext.decodeAudioData(encoded.slice(0));
      if (decoded.length === 0) {
        return await speakWithBrowserTts();
      }
      appendOutputAudioFrame(turnId, new Float32Array(decoded.getChannelData(0)));

      if (phaseRef.current === "thinking") {
        applyPhase("speaking");
      }
      if (onWaveformAudio && analyserRaf === 0) {
        analyserRaf = window.requestAnimationFrame(emitTtsMetrics);
      }

      if (ttsFirstAudio === null) {
        const latencyMs = Math.round(performance.now() - replyStartedAt);
        ttsFirstAudio = latencyMs;
        setTtsFirstAudioMs(latencyMs);
        if (currentReplyContextRef.current?.turnId === turnId) {
          currentReplyContextRef.current.ttsFirstAudioMs = latencyMs;
        }
      }

      const source = audioContext.createBufferSource();
      source.buffer = decoded;
      source.connect(gainNode);
      const now = audioContext.currentTime;
      const startAt = Math.max(now, nextStartTime);
      source.start(startAt);
      nextStartTime = startAt + decoded.duration;
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
      });
      ttsDurationMs = Math.max(
        ttsDurationMs ?? 0,
        Math.round(decoded.duration * 1000),
      );
      console.log(
        `[voice] fallback tts playback complete (${payload.provider ?? "unknown"})`,
      );
      return { ok: true, durationMs: Math.round(decoded.duration * 1000) };
    };

    // Get or create the speculation that owns the LLM→TTS stream.
    let speculation: Speculation;
    if (preFired) {
      speculation = preFired;
    } else {
      // Resolve cached context (await prefetch if still in-flight).
      let cachedContext: VoiceContext | null = voiceContextRef.current.cached;
      if (!cachedContext && voiceContextRef.current.promise) {
        try {
          cachedContext = await voiceContextRef.current.promise;
        } catch {
          cachedContext = null;
        }
      }

      const history = voiceTurns
        .filter((t) => t.status === "complete")
        .flatMap((t) => [
          { role: "user" as const, content: t.user },
          { role: "assistant" as const, content: t.assistant },
        ]);

      speculation = startSpeculation({
        url: `/api/characters/${character.id}/voice-stream`,
        body: {
          sessionId: worldSessionIdRef.current ?? undefined,
          turnId,
          promptChunk: cachedContext?.promptChunk ?? "",
          message: userTranscript,
          history,
          provider,
          model,
        },
        transcript: userTranscript,
      });
      turnTraceRef.current?.mark("voice-stream.posted", { provider, model });
      setPipelineStatus((current) => ({
        ...current,
        speculation: "buffering",
        llm: {
          ...current.llm,
          state: "waiting",
          provider,
          model,
          error: null,
        },
        tts: {
          ...current.tts,
          state: "waiting",
          error: null,
        },
      }));
    }

    activeAudioRef.current = {
      gainNode,
      fadeOutToZero,
      abortActiveTurn: () => speculation.abort(),
    };

    try {
      // Telemetry: capture the first occurrence of each milestone, then print
      // a unified per-turn timeline on `done`.
      let firstTokenSeen = false;
      let firstAudioFrameSeen = false;

      await new Promise<void>((resolve, reject) => {
        setPipelineStatus((current) => ({
          ...current,
          speculation: "committed",
          llm: { ...current.llm, state: "active", provider, model, error: null },
          tts: { ...current.tts, state: "waiting", error: null },
        }));
        speculation.commit({
          onToken: (delta) => {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              turnTraceRef.current?.mark("sse.first-token");
            }
            assistant += delta;
            setPipelineStatus((current) => ({
              ...current,
              llm: {
                ...current.llm,
                state: "active",
                tokenEvents: current.llm.tokenEvents + 1,
                chars: current.llm.chars + delta.length,
                firstTokenAt: current.llm.firstTokenAt ?? performance.now(),
                lastTokenAt: performance.now(),
                preview: (current.llm.preview + delta).slice(-160),
                error: null,
              },
            }));
            if (currentReplyContextRef.current?.turnId === turnId) {
              currentReplyContextRef.current.assistant = assistant;
            }
            setLiveReply(assistant);
          },
          onFirstAudio: (latencyMs) => {
            streamedAnyAudio = true;
            ttsFirstAudio = latencyMs;
            setTtsFirstAudioMs(latencyMs);
            setPipelineStatus((current) => ({
              ...current,
              tts: {
                ...current.tts,
                state: "active",
                firstAudioMs: latencyMs,
                lastAudioAt: performance.now(),
                error: null,
              },
            }));
            turnTraceRef.current?.mark("sse.first-audio", { latencyMs });
            if (currentReplyContextRef.current?.turnId === turnId) {
              currentReplyContextRef.current.ttsFirstAudioMs = latencyMs;
            }
            if (phaseRef.current === "thinking") {
              applyPhase("speaking");
              if (onWaveformAudio && analyserRaf === 0) {
                analyserRaf = window.requestAnimationFrame(emitTtsMetrics);
              }
            }
            console.log(
              `[voice] tts first audio ${latencyMs}ms after stream start`,
            );
          },
          onAudioFrame: (samples) => {
            appendOutputAudioFrame(turnId, samples);
            if (!firstAudioFrameSeen) {
              firstAudioFrameSeen = true;
              turnTraceRef.current?.mark("audio.first-frame-received", {
                samples: samples.length,
              });
            }
            setPipelineStatus((current) => ({
              ...current,
              tts: {
                ...current.tts,
                state: "active",
                audioFrames: current.tts.audioFrames + 1,
                audioSamples: current.tts.audioSamples + samples.length,
                lastAudioAt: performance.now(),
                error: null,
              },
            }));
            scheduleAudio(samples);
          },
          onDone: (info) => {
            replyMs = Math.round(performance.now() - replyStartedAt);
            ttsDurationMs = info.durationMs ?? null;
            if (ttsFirstAudio === null && typeof info.firstAudioMs === "number") {
              ttsFirstAudio = info.firstAudioMs;
              setTtsFirstAudioMs(info.firstAudioMs);
            }
            console.log(
              `[voice] tts complete: ${info.audioSamples ?? "?"} samples (${info.durationMs ?? "?"}ms audio, total ${info.totalMs ?? "?"}ms)`,
            );
            setPipelineStatus((current) => ({
              ...current,
              llm: {
                ...current.llm,
                state: "ready",
                inputTokens: info.inputTokens ?? current.llm.inputTokens,
                outputTokens: info.outputTokens ?? current.llm.outputTokens,
              },
              tts: {
                ...current.tts,
                state: "ready",
                audioSamples: info.audioSamples ?? current.tts.audioSamples,
                durationMs: info.durationMs ?? current.tts.durationMs,
                firstAudioMs: info.firstAudioMs ?? current.tts.firstAudioMs,
              },
            }));
            // Mark + merge server trace + print full timeline.
            const trace = turnTraceRef.current;
            if (trace) {
              trace.mark("sse.done", {
                inputTokens: info.inputTokens,
                outputTokens: info.outputTokens,
              });
              const serverTrace = info.serverTrace;
              if (serverTrace) {
                const offset = trace.at("voice-stream.posted") ?? 0;
                trace.merge(serverTrace, offset);
              }
            }
            resolve();
          },
          onError: (message) => {
            setPipelineStatus((current) => ({
              ...current,
              llm: {
                ...current.llm,
                state: current.llm.tokenEvents > 0 ? current.llm.state : "error",
                error: message,
              },
              tts: {
                ...current.tts,
                state: current.tts.audioFrames > 0 ? current.tts.state : "error",
                error: message,
              },
            }));
            reject(new Error(message));
          },
        });
      });

      await waitForQueuedPlayback();
      if (currentReplyContextRef.current?.turnId !== turnId) {
        return;
      }
      const trace = turnTraceRef.current;
      if (trace) {
        if (streamedAnyAudio) {
          trace.mark("audio.playback-drained", {
            scheduledSources: scheduledSourceCount,
          });
        }
        console.log(trace.print(`turn ${turnId.slice(0, 8)}`));
        console.log(`[voice] turn summary`, trace.summary());
        persistWorldTurn({
          turnId,
          status: "complete",
          userTranscript,
          assistant: assistant.trim(),
          listenMs,
          replyMs,
          ttsFirstAudio,
          ttsDurationMs,
          trace,
        });
        turnTraceRef.current = null;
      }

      assistant = assistant.trim();
      if (!assistant) {
        throw new Error("Empty reply from voice-stream backend.");
      }

      // If the context was cleared while we were waiting, the interrupt
      // handler already saved an "interrupted" turn — don't double-record.
      if (currentReplyContextRef.current?.turnId !== turnId) {
        return;
      }

      if (!streamedAnyAudio) {
        console.log(
          "[voice] streamed turn had no audio frames; trying /api/audio/speak fallback",
        );
        setPipelineStatus((current) => ({
          ...current,
          tts: {
            ...current.tts,
            state: "waiting",
            error: "No streamed audio frames arrived; trying fallback TTS.",
          },
        }));
        const fallback = await playFallbackTts(assistant);
        if (!fallback.ok) {
          throw new Error(
            `Voice reply text arrived, but no TTS audio was available. ${fallback.error ?? ""}`.trim(),
          );
        }
        setPipelineStatus((current) => ({
          ...current,
          tts: {
            ...current.tts,
            state: "ready",
            durationMs: fallback.durationMs ?? current.tts.durationMs,
            error: null,
          },
        }));
        if (ttsDurationMs === null && typeof fallback.durationMs === "number") {
          ttsDurationMs = fallback.durationMs;
        }
      }

      // The user may have barged-in while fallback audio was playing.
      if (currentReplyContextRef.current?.turnId !== turnId) {
        return;
      }

      finishOutputAudioCapture(turnId, ttsDurationMs);

      setVoiceTurns((current) => [
        ...current,
        {
          id: turnId,
          user: userTranscript,
          assistant,
          status: "complete",
          error: null,
          listenMs,
          replyMs,
          ttsFirstAudioMs: ttsFirstAudio,
          ttsDurationMs,
        },
      ]);
      setLiveReply("");
      if (allowMicWaveform) {
        onWaveformAudio?.({
          energy: Math.max(0, Math.min(1, lastMicLevelRef.current * 8.5)),
          bass: Math.max(0, Math.min(1, lastMicLevelRef.current * 6.8)),
          mid: Math.max(0, Math.min(1, lastMicLevelRef.current * 7.6)),
          high: Math.max(0, Math.min(1, lastMicLevelRef.current * 5.2)),
          peak: Math.max(0, Math.min(1, lastMicLevelRef.current * 8.5)),
          active: voiceModeActiveRef.current,
        });
      } else {
        onWaveformAudio?.({
          energy: 0,
          bass: 0,
          mid: 0,
          high: 0,
          peak: 0,
          active: false,
        });
      }
      currentReplyContextRef.current = null;

      // Drop straight back into listening — mic stays on.
      if (voiceModeActiveRef.current && phaseRef.current !== "listening") {
        applyPhase("listening");
      }
    } catch (turnError) {
      // If aborted by interrupt or by exit, the corresponding handler
      // already cleared currentReplyContextRef. Don't double-record the turn.
      if (currentReplyContextRef.current?.turnId !== turnId) {
        return;
      }

      fadeOutToZero();
      const message =
        turnError instanceof Error ? turnError.message : "Voice turn failed.";
      setPipelineStatus((current) => ({
        ...current,
        llm: {
          ...current.llm,
          state: current.llm.state === "ready" ? "ready" : "error",
          error: message,
        },
        tts: {
          ...current.tts,
          state: current.tts.state === "ready" ? "ready" : "error",
          error: message,
        },
      }));
      setVoiceTurns((current) => [
        ...current,
        {
          id: turnId,
          user: userTranscript,
          assistant,
          status: "error",
          error: message,
          listenMs,
          replyMs,
          ttsFirstAudioMs: ttsFirstAudio,
          ttsDurationMs,
        },
      ]);
      const trace = turnTraceRef.current;
      trace?.mark("turn.error", { message });
      finishOutputAudioCapture(turnId, ttsDurationMs);
      persistWorldTurn({
        turnId,
        status: "error",
        userTranscript,
        assistant,
        listenMs,
        replyMs,
        ttsFirstAudio,
        ttsDurationMs,
        trace: trace ?? undefined,
        extraMetadata: { message },
      });
      turnTraceRef.current = null;
      setError(message);
      applyPhase("error");
      currentReplyContextRef.current = null;
      onWaveformAudio?.({
        energy: 0,
        bass: 0,
        mid: 0,
        high: 0,
        peak: 0,
        active: voiceModeActiveRef.current,
      });
    } finally {
      clearPlaybackStartTimers();
      if (analyserRaf !== 0) {
        window.cancelAnimationFrame(analyserRaf);
        analyserRaf = 0;
      }
      if (activeAudioRef.current?.gainNode === gainNode) {
        activeAudioRef.current = null;
      }
    }
  }

  function clearTurns() {
    setVoiceTurns([]);
    setCurrentTurnTranscript("");
    setLiveReply("");
    setError(null);
    setTtsFirstAudioMs(null);
  }

  function toggleVoiceMode() {
    if (voiceModeActiveRef.current) {
      void exitVoiceMode();
    } else {
      void enterVoiceMode();
    }
  }

  function togglePipelineSection(section: PipelineSectionId) {
    setCollapsedPipelineSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  useImperativeHandle(
    ref,
    () => ({
      toggleVoiceMode: () => {
        toggleVoiceMode();
      },
      enterVoiceMode: () => {
        void enterVoiceMode();
      },
      exitVoiceMode: () => {
        void exitVoiceMode();
      },
    }),
    [enterVoiceMode, exitVoiceMode, toggleVoiceMode],
  );

  const isListening = voiceModeActive && phase === "listening";
  const micPercent = Math.max(0, Math.min(100, Math.round(micLevel * 1200)));
  const vadPercent = Math.max(0, Math.min(100, Math.round(vadPause * 100)));
  const halo = voiceModeActive
    ? phase === "listening"
      ? "rgba(239, 68, 68, 0.5)"
      : phase === "speaking"
        ? "rgba(74, 222, 128, 0.5)"
        : phase === "thinking"
          ? "rgba(140, 231, 210, 0.5)"
          : phase === "warming"
            ? "rgba(140, 231, 210, 0.4)"
            : "rgba(255, 255, 255, 0.2)"
    : "transparent";

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column" }}>
      <style>{`
        @keyframes voice-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "32px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            paddingTop: 12,
          }}
        >
          <button
            type="button"
            onClick={toggleVoiceMode}
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              border: `2px solid ${voiceModeActive ? halo : T.border}`,
              background: voiceModeActive
                ? phase === "listening"
                  ? "rgba(239, 68, 68, 0.12)"
                  : phase === "speaking"
                    ? "rgba(74, 222, 128, 0.12)"
                    : "rgba(140, 231, 210, 0.10)"
                : T.panel,
              color: T.fg,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
              position: "relative",
            }}
            aria-label={voiceModeActive ? "Exit voice mode" : "Enter voice mode"}
          >
            {!voiceModeActive ? (
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : phase === "warming" ? (
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                style={{
                  animation: "voice-spin 0.9s linear infinite",
                }}
              >
                <path d="M12 3a9 9 0 0 1 9 9" />
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            )}
            {voiceModeActive ? (
              <span
                style={{
                  position: "absolute",
                  inset: -6,
                  borderRadius: "50%",
                  border: `2px solid ${halo}`,
                  transform: `scale(${1 + micLevel * 4})`,
                  transition: "transform 0.05s linear",
                  pointerEvents: "none",
                }}
              />
            ) : null}
          </button>
          <div
            style={{
              fontFamily: T.fontMono,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: phaseColor(phase, voiceModeActive),
              textAlign: "center",
            }}
          >
            {phaseLabel(phase, voiceModeActive)}
            {phase === "speaking" && ttsFirstAudioMs !== null
              ? ` · first audio ${ttsFirstAudioMs}ms`
              : null}
          </div>

          <VoiceReadinessPanel
            status={startupStatus}
            now={statusNow}
            voiceModeActive={voiceModeActive}
            phase={phase}
            micPercent={micPercent}
            vadPercent={vadPercent}
            isListening={isListening}
          />

        </div>

        {voiceModeActive || phase === "error" ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: T.muted,
                }}
              >
                Live pipeline segments
              </span>
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 9,
                  color: T.muted,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                STT · LLM · TTS
              </span>
            </div>
            <VoiceDataFlowPanels
              startupStatus={startupStatus}
              pipelineStatus={pipelineStatus}
              now={statusNow}
              micPercent={micPercent}
              vadPercent={vadPercent}
              collapsedSections={collapsedPipelineSections}
              onToggleSection={togglePipelineSection}
            />
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={() => setTranscriptPanelHidden((prev) => !prev)}
            style={{
              padding: "6px 10px",
              borderRadius: 7,
              border: `1px solid ${T.border}`,
              background: transcriptPanelHidden ? "rgba(140,231,210,0.1)" : "transparent",
              color: transcriptPanelHidden ? T.accent : T.muted,
              fontFamily: T.fontMono,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
            aria-expanded={!transcriptPanelHidden}
            aria-controls="voice-transcript-panel"
          >
            {transcriptPanelHidden ? "Show transcript" : "Hide transcript"}
          </button>
        </div>

        {!transcriptPanelHidden ? (
          <div
            id="voice-transcript-panel"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {error ? (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(248, 113, 113, 0.3)",
                  background: "rgba(248, 113, 113, 0.08)",
                  color: "#f87171",
                  fontFamily: T.fontBody,
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            ) : null}

            {currentTurnTranscript ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: `1px solid ${T.border}`,
                  background: T.panel,
                }}
              >
                <p
                  style={{
                    fontFamily: T.fontMono,
                    fontSize: 10,
                    color: T.muted,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    margin: 0,
                    marginBottom: 6,
                  }}
                >
                  You{" "}
                  {isListening
                    ? "saying"
                    : phase === "thinking" || phase === "speaking"
                      ? "(barging in)"
                      : "said"}
                </p>
                <p
                  style={{
                    fontFamily: T.fontBody,
                    fontSize: 14,
                    color: T.fg,
                    margin: 0,
                  }}
                >
                  {currentTurnTranscript}
                </p>
              </div>
            ) : null}

            {liveReply ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: `1px solid ${T.border}`,
                  background: T.panel,
                }}
              >
                <p
                  style={{
                    fontFamily: T.fontMono,
                    fontSize: 10,
                    color: T.muted,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    margin: 0,
                    marginBottom: 6,
                  }}
                >
                  {character.title}
                </p>
                <p
                  style={{
                    fontFamily: T.fontBody,
                    fontSize: 14,
                    color: T.fg,
                    margin: 0,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {liveReply}
                </p>
              </div>
            ) : null}

            {voiceTurns.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontFamily: T.fontMono,
                      fontSize: 10,
                      fontWeight: 500,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: T.muted,
                    }}
                  >
                    Voice history · {voiceTurns.length}
                  </span>
                  <button
                    type="button"
                    onClick={clearTurns}
                    style={{
                      padding: "4px 10px",
                      fontFamily: T.fontMono,
                      fontSize: 10,
                      fontWeight: 500,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: T.muted,
                      background: "transparent",
                      border: `1px solid ${T.border}`,
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>
                {voiceTurns.map((turn) => (
                  <article
                    key={turn.id}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: `1px solid ${
                        turn.status === "error"
                          ? "rgba(248,113,113,0.3)"
                          : turn.status === "interrupted"
                            ? "rgba(250,204,21,0.3)"
                            : T.border
                      }`,
                      background: T.panel,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {turn.status === "interrupted" ? (
                      <span
                        style={{
                          alignSelf: "flex-start",
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "rgba(250,204,21,0.08)",
                          border: "1px solid rgba(250,204,21,0.25)",
                          fontFamily: T.fontMono,
                          fontSize: 9,
                          fontWeight: 600,
                          color: "#FACC15",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                        }}
                      >
                        Interrupted
                      </span>
                    ) : null}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: 10,
                          color: T.muted,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                        }}
                      >
                        You
                      </span>
                      <p
                        style={{
                          margin: 0,
                          fontFamily: T.fontBody,
                          fontSize: 13,
                          color: T.fg,
                        }}
                      >
                        {turn.user || "(empty)"}
                      </p>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: 10,
                          color: T.muted,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                        }}
                      >
                        {character.title}
                      </span>
                      <p
                        style={{
                          margin: 0,
                          fontFamily: T.fontBody,
                          fontSize: 13,
                          color: T.fg,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {turn.assistant || (turn.error ? `Error: ${turn.error}` : "(empty)")}
                      </p>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        fontFamily: T.fontMono,
                        fontSize: 10,
                        color: T.muted,
                        letterSpacing: "0.06em",
                      }}
                    >
                      <span>listen {turn.listenMs ?? "—"}ms</span>
                      <span>reply {turn.replyMs ?? "—"}ms</span>
                      <span>tts→1st {turn.ttsFirstAudioMs ?? "—"}ms</span>
                      <span>tts dur {turn.ttsDurationMs ?? "—"}ms</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            id="voice-transcript-panel"
            style={{
              marginTop: 4,
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: T.panel,
              fontFamily: T.fontMono,
              fontSize: 10,
              color: T.muted,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Transcript hidden
            {voiceTurns.length > 0 ? ` · ${voiceTurns.length} turn${voiceTurns.length === 1 ? "" : "s"}` : ""}
          </div>
        )}
      </div>
    </div>
  );
});

CharacterVoicePanel.displayName = "CharacterVoicePanel";
