"use client";

import { useEffect, useRef, useState } from "react";
import StreamingPanel from "./streaming-panel";
import {
  decodeBlobToPCM24k,
  synthesizeBatchViaKyutai,
  transcribeBatchViaRustServer,
} from "./moshi-client";

type SttProvider = "kyutai-rust" | "kyutai" | "openai";
type TtsProvider = "kyutai-rust" | "elevenlabs" | "openai";

type GatewayHealth = {
  configured: boolean;
  baseUrl: string | null;
  ok?: boolean;
  status?: number;
  latencyMs?: number;
  payload?: unknown;
  error?: string;
};

type StageStatus = "idle" | "running" | "ok" | "error";

type StageState<T> = {
  status: StageStatus;
  startedAt: number | null;
  finishedAt: number | null;
  latencyMs: number | null;
  result: T | null;
  error: string | null;
  raw: unknown;
};

type AudioInput = {
  base64: string;
  mimeType: string;
  sizeBytes: number;
  sourceLabel: string;
  durationMs: number | null;
  blobUrl: string;
};

type SttResult = {
  transcript: string;
  provider: string;
  model?: string;
};

type ReplyResult = {
  reply: string;
  provider: string;
  model: string;
};

type TtsResult = {
  audioBase64: string;
  mimeType: string;
  provider: string;
  fallbackUsed: boolean;
  blobUrl: string;
};

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

function nowLabel() {
  return new Date().toLocaleTimeString();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read audio blob."));
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid audio encoding."));
        return;
      }
      const encoded = reader.result.split(",")[1] ?? "";
      resolve(encoded);
    };
    reader.readAsDataURL(blob);
  });
}

function decodeBase64ToBlob(base64: string, mimeType: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function resolveRecorderMime() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}

function emptyStage<T>(): StageState<T> {
  return {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    latencyMs: null,
    result: null,
    error: null,
    raw: null,
  };
}

function statusColor(status: StageStatus) {
  switch (status) {
    case "running":
      return "var(--accent)";
    case "ok":
      return "var(--success, #4ade80)";
    case "error":
      return "var(--danger, #f87171)";
    default:
      return "var(--muted, #71717a)";
  }
}

function statusLabel(status: StageStatus) {
  switch (status) {
    case "running":
      return "RUNNING";
    case "ok":
      return "OK";
    case "error":
      return "ERROR";
    default:
      return "IDLE";
  }
}

export default function VoiceDebugPage() {
  const [audioInput, setAudioInput] = useState<AudioInput | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const [sttProvider, setSttProvider] = useState<SttProvider>("kyutai-rust");
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>("kyutai-rust");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a concise voice assistant. Respond naturally in 1-3 sentences.",
  );

  const [sttStage, setSttStage] = useState<StageState<SttResult>>(emptyStage());
  const [replyStage, setReplyStage] = useState<StageState<ReplyResult>>(emptyStage());
  const [ttsStage, setTtsStage] = useState<StageState<TtsResult>>(emptyStage());

  const [gateway, setGateway] = useState<GatewayHealth | null>(null);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [warming, setWarming] = useState(false);
  const [warmResult, setWarmResult] = useState<{ ok: boolean; latencyMs?: number; payload?: unknown; error?: string } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingStartRef = useRef<number>(0);

  useEffect(() => {
    void probeGateway();
    return () => {
      stopRecorderTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopRecorderTracks() {
    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current = null;
    }
  }

  async function probeGateway() {
    setGatewayLoading(true);
    try {
      const response = await fetch("/api/audio/gateway-health", { cache: "no-store" });
      const payload = (await response.json()) as GatewayHealth;
      setGateway(payload);
    } catch (error) {
      setGateway({
        configured: false,
        baseUrl: null,
        error: error instanceof Error ? error.message : "Probe failed.",
      });
    } finally {
      setGatewayLoading(false);
    }
  }

  async function warmGateway() {
    setWarming(true);
    setWarmResult(null);
    try {
      const response = await fetch("/api/audio/gateway-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ silenceMs: 800 }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        latencyMs?: number;
        payload?: unknown;
        error?: string;
      };
      setWarmResult({
        ok: Boolean(payload.ok),
        latencyMs: payload.latencyMs,
        payload: payload.payload,
        error: payload.error,
      });
      void probeGateway();
    } catch (error) {
      setWarmResult({
        ok: false,
        error: error instanceof Error ? error.message : "Warm failed.",
      });
    } finally {
      setWarming(false);
    }
  }

  async function startRecording() {
    setRecordingError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      recordingStreamRef.current = stream;
      const mime = resolveRecorderMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const blob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const base64 = await blobToBase64(blob);
        const blobUrl = URL.createObjectURL(blob);
        const durationMs = Date.now() - recordingStartRef.current;
        setAudioInput((current) => {
          if (current?.blobUrl) {
            URL.revokeObjectURL(current.blobUrl);
          }
          return {
            base64,
            mimeType: blob.type || "audio/webm",
            sizeBytes: blob.size,
            sourceLabel: `Recorded · ${nowLabel()}`,
            durationMs,
            blobUrl,
          };
        });
        recorderChunksRef.current = [];
        stopRecorderTracks();
      };
      recordingStartRef.current = Date.now();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : "Could not start recording.");
      stopRecorderTracks();
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    recorderRef.current = null;
    setRecording(false);
  }

  async function handleFileUpload(file: File) {
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type || "audio/webm" });
    const base64 = await blobToBase64(blob);
    const blobUrl = URL.createObjectURL(blob);
    setAudioInput((current) => {
      if (current?.blobUrl) {
        URL.revokeObjectURL(current.blobUrl);
      }
      return {
        base64,
        mimeType: blob.type || file.type || "audio/webm",
        sizeBytes: file.size,
        sourceLabel: `File · ${file.name}`,
        durationMs: null,
        blobUrl,
      };
    });
  }

  function clearAudio() {
    setAudioInput((current) => {
      if (current?.blobUrl) URL.revokeObjectURL(current.blobUrl);
      return null;
    });
    setSttStage(emptyStage());
    setReplyStage(emptyStage());
    setTtsStage(emptyStage());
  }

  async function runStt() {
    if (!audioInput) return;
    const startedAt = performance.now();
    setSttStage({
      status: "running",
      startedAt,
      finishedAt: null,
      latencyMs: null,
      result: null,
      error: null,
      raw: null,
    });
    setReplyStage(emptyStage());
    setTtsStage(emptyStage());

    if (sttProvider === "kyutai-rust") {
      try {
        const blob = await fetch(audioInput.blobUrl).then((r) => r.blob());
        const samples = await decodeBlobToPCM24k(blob);
        const result = await transcribeBatchViaRustServer(samples, {
          timeoutMs: 60000,
        });
        const finishedAt = performance.now();
        const latencyMs = Math.round(finishedAt - startedAt);
        setSttStage({
          status: "ok",
          startedAt,
          finishedAt,
          latencyMs,
          result: {
            transcript: result.transcript,
            provider: "kyutai-rust",
            model: "kyutai/stt-1b-en_fr-candle (moshi-server)",
          },
          error: null,
          raw: {
            transcript: result.transcript,
            words: result.words,
            samples: samples.length,
            sampleRate: 24000,
          },
        });
      } catch (error) {
        const finishedAt = performance.now();
        setSttStage({
          status: "error",
          startedAt,
          finishedAt,
          latencyMs: Math.round(finishedAt - startedAt),
          result: null,
          error: error instanceof Error ? error.message : "moshi-server request failed.",
          raw: null,
        });
      }
      return;
    }

    try {
      const response = await fetch("/api/audio/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: audioInput.base64,
          mimeType: audioInput.mimeType,
          provider: sttProvider,
        }),
      });
      const payload = (await response.json()) as {
        transcript?: string;
        provider?: string;
        model?: string;
        error?: string;
        latencyMs?: number;
      };
      const finishedAt = performance.now();
      const latencyMs = Math.round(finishedAt - startedAt);

      if (!response.ok || payload.error) {
        setSttStage({
          status: "error",
          startedAt,
          finishedAt,
          latencyMs,
          result: null,
          error: payload.error ?? `HTTP ${response.status}`,
          raw: payload,
        });
        return;
      }

      setSttStage({
        status: "ok",
        startedAt,
        finishedAt,
        latencyMs,
        result: {
          transcript: payload.transcript ?? "",
          provider: payload.provider ?? sttProvider,
          model: payload.model,
        },
        error: null,
        raw: payload,
      });
    } catch (error) {
      const finishedAt = performance.now();
      setSttStage({
        status: "error",
        startedAt,
        finishedAt,
        latencyMs: Math.round(finishedAt - startedAt),
        result: null,
        error: error instanceof Error ? error.message : "STT request failed.",
        raw: null,
      });
    }
  }

  async function runReply() {
    const transcript = sttStage.result?.transcript?.trim();
    if (!transcript) return;
    const startedAt = performance.now();
    setReplyStage({
      status: "running",
      startedAt,
      finishedAt: null,
      latencyMs: null,
      result: null,
      error: null,
      raw: null,
    });
    setTtsStage(emptyStage());

    try {
      const response = await fetch("/api/audio/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          systemPrompt: systemPrompt.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as {
        reply?: string;
        model?: string;
        provider?: string;
        error?: string;
      };
      const finishedAt = performance.now();
      const latencyMs = Math.round(finishedAt - startedAt);

      if (!response.ok || payload.error) {
        setReplyStage({
          status: "error",
          startedAt,
          finishedAt,
          latencyMs,
          result: null,
          error: payload.error ?? `HTTP ${response.status}`,
          raw: payload,
        });
        return;
      }

      setReplyStage({
        status: "ok",
        startedAt,
        finishedAt,
        latencyMs,
        result: {
          reply: payload.reply ?? "",
          provider: payload.provider ?? "openai",
          model: payload.model ?? "unknown",
        },
        error: null,
        raw: payload,
      });
    } catch (error) {
      const finishedAt = performance.now();
      setReplyStage({
        status: "error",
        startedAt,
        finishedAt,
        latencyMs: Math.round(finishedAt - startedAt),
        result: null,
        error: error instanceof Error ? error.message : "Reply request failed.",
        raw: null,
      });
    }
  }

  async function runTts() {
    const text = replyStage.result?.reply?.trim();
    if (!text) return;
    const startedAt = performance.now();
    setTtsStage({
      status: "running",
      startedAt,
      finishedAt: null,
      latencyMs: null,
      result: null,
      error: null,
      raw: null,
    });

    if (ttsProvider === "kyutai-rust") {
      try {
        const result = await synthesizeBatchViaKyutai(text);
        const audioBlob = decodeBase64ToBlob(result.audioBase64, result.mimeType);
        const blobUrl = URL.createObjectURL(audioBlob);
        const finishedAt = performance.now();
        const latencyMs = Math.round(finishedAt - startedAt);
        setTtsStage((current) => {
          if (current.result?.blobUrl) URL.revokeObjectURL(current.result.blobUrl);
          return {
            status: "ok",
            startedAt,
            finishedAt,
            latencyMs,
            result: {
              audioBase64: result.audioBase64,
              mimeType: result.mimeType,
              provider: "kyutai-rust",
              fallbackUsed: false,
              blobUrl,
            },
            error: null,
            raw: {
              firstAudioMs: result.firstAudioMs,
              durationMs: result.durationMs,
              totalMs: result.totalMs,
              sampleRate: result.sampleRate,
              samples: result.pcm.length,
            },
          };
        });
      } catch (error) {
        const finishedAt = performance.now();
        setTtsStage({
          status: "error",
          startedAt,
          finishedAt,
          latencyMs: Math.round(finishedAt - startedAt),
          result: null,
          error: error instanceof Error ? error.message : "Kyutai TTS request failed.",
          raw: null,
        });
      }
      return;
    }

    try {
      const response = await fetch("/api/audio/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, provider: ttsProvider }),
      });
      const payload = (await response.json()) as {
        audioBase64?: string;
        mimeType?: string;
        provider?: string;
        fallbackUsed?: boolean;
        error?: string;
        details?: string[];
      };
      const finishedAt = performance.now();
      const latencyMs = Math.round(finishedAt - startedAt);

      if (!response.ok || !payload.audioBase64 || !payload.mimeType || payload.error) {
        setTtsStage({
          status: "error",
          startedAt,
          finishedAt,
          latencyMs,
          result: null,
          error: payload.error ?? payload.details?.join(" | ") ?? `HTTP ${response.status}`,
          raw: payload,
        });
        return;
      }

      const audioBlob = decodeBase64ToBlob(payload.audioBase64, payload.mimeType);
      const blobUrl = URL.createObjectURL(audioBlob);

      setTtsStage((current) => {
        if (current.result?.blobUrl) URL.revokeObjectURL(current.result.blobUrl);
        return {
          status: "ok",
          startedAt,
          finishedAt,
          latencyMs,
          result: {
            audioBase64: payload.audioBase64 ?? "",
            mimeType: payload.mimeType ?? "audio/mpeg",
            provider: payload.provider ?? ttsProvider,
            fallbackUsed: payload.fallbackUsed ?? false,
            blobUrl,
          },
          error: null,
          raw: payload,
        };
      });
    } catch (error) {
      const finishedAt = performance.now();
      setTtsStage({
        status: "error",
        startedAt,
        finishedAt,
        latencyMs: Math.round(finishedAt - startedAt),
        result: null,
        error: error instanceof Error ? error.message : "TTS request failed.",
        raw: null,
      });
    }
  }

  async function runFullPipeline() {
    if (!audioInput) return;
    await runStt();
    await new Promise((r) => setTimeout(r, 50));
    if (sttStageHasTranscriptRef.current) {
      await runReply();
      await new Promise((r) => setTimeout(r, 50));
      if (replyStageHasReplyRef.current) {
        await runTts();
      }
    }
  }

  const sttStageHasTranscriptRef = useRef(false);
  const replyStageHasReplyRef = useRef(false);
  useEffect(() => {
    sttStageHasTranscriptRef.current = Boolean(sttStage.result?.transcript?.trim());
  }, [sttStage]);
  useEffect(() => {
    replyStageHasReplyRef.current = Boolean(replyStage.result?.reply?.trim());
  }, [replyStage]);

  const totalLatencyMs =
    (sttStage.latencyMs ?? 0) + (replyStage.latencyMs ?? 0) + (ttsStage.latencyMs ?? 0);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Tools · Debug</p>
        <h1 className="mt-2 text-3xl font-semibold">Voice Debug</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Stage-by-stage tester for the STT → LLM → TTS pipeline. Pick providers per stage, record or
          upload audio, and run each step independently to isolate failures and compare latencies.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Kyutai Gateway</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">audio-rt FastAPI service health and runtime state.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void probeGateway()}
              disabled={gatewayLoading}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-xs hover:bg-[var(--panel)]/70 disabled:opacity-50"
            >
              {gatewayLoading ? "Probing…" : "Probe /healthz"}
            </button>
            <button
              type="button"
              onClick={() => void warmGateway()}
              disabled={warming || !gateway?.configured}
              className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs hover:bg-[var(--accent)]/20 disabled:opacity-50"
            >
              {warming ? "Warming model…" : "Warm STT model"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-black/30 p-3 text-xs">
            <p className="font-mono uppercase tracking-[0.08em] text-[var(--muted)]">Health probe</p>
            {gateway === null ? (
              <p className="mt-2 text-[var(--muted)]">Not probed yet.</p>
            ) : !gateway.configured ? (
              <p className="mt-2 text-[var(--danger,#f87171)]">KYUTAI_BASE_URL not set.</p>
            ) : (
              <div className="mt-2 space-y-1 text-[var(--muted)]">
                <p>URL: <span className="break-all">{gateway.baseUrl}</span></p>
                <p>HTTP: {gateway.status ?? "—"} · {gateway.latencyMs ?? "—"}ms</p>
                {gateway.error ? (
                  <p className="text-[var(--danger,#f87171)]">Error: {gateway.error}</p>
                ) : null}
              </div>
            )}
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-[var(--muted)]">
              {gateway?.payload ? JSON.stringify(gateway.payload, null, 2) : "—"}
            </pre>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-black/30 p-3 text-xs">
            <p className="font-mono uppercase tracking-[0.08em] text-[var(--muted)]">Warm-up result</p>
            {warmResult === null ? (
              <p className="mt-2 text-[var(--muted)]">No warm-up yet. First /transcribe call lazy-loads the model on the gateway (often 30-90s on CPU).</p>
            ) : (
              <div className="mt-2 space-y-1 text-[var(--muted)]">
                <p>Status: <span style={{ color: warmResult.ok ? "var(--success,#4ade80)" : "var(--danger,#f87171)" }}>{warmResult.ok ? "OK" : "FAIL"}</span></p>
                <p>Latency: {warmResult.latencyMs ?? "—"}ms</p>
                {warmResult.error ? (
                  <p className="text-[var(--danger,#f87171)]">{warmResult.error}</p>
                ) : null}
              </div>
            )}
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-[var(--muted)]">
              {warmResult?.payload ? JSON.stringify(warmResult.payload, null, 2) : "—"}
            </pre>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-medium">1. Audio input</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Record from mic or upload an audio file. Re-usable across stages — uploads keep tests repeatable.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {!recording ? (
            <button
              type="button"
              onClick={() => void startRecording()}
              className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2 text-sm hover:bg-[var(--accent)]/20"
            >
              ● Record
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="rounded-lg border border-[var(--danger,#f87171)] bg-[var(--danger,#f87171)]/10 px-4 py-2 text-sm text-[var(--danger,#f87171)]"
            >
              ■ Stop
            </button>
          )}

          <label className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm hover:bg-[var(--panel)]/70">
            Upload audio file
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFileUpload(file);
                event.target.value = "";
              }}
            />
          </label>

          {audioInput ? (
            <button
              type="button"
              onClick={clearAudio}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--panel)]/70"
            >
              Clear
            </button>
          ) : null}
        </div>

        {recordingError ? (
          <p className="mt-3 rounded-lg border border-[var(--danger,#f87171)] bg-[var(--danger,#f87171)]/10 px-3 py-2 text-sm text-[var(--danger,#f87171)]">
            {recordingError}
          </p>
        ) : null}

        {audioInput ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-black/30 p-3 text-xs text-[var(--muted)]">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <p>Source: {audioInput.sourceLabel}</p>
              <p>Mime: {audioInput.mimeType}</p>
              <p>Size: {formatBytes(audioInput.sizeBytes)}</p>
              {audioInput.durationMs !== null ? <p>Captured: {audioInput.durationMs} ms</p> : null}
              <p>Base64: {Math.round(audioInput.base64.length / 1024)} KB</p>
            </div>
            <audio src={audioInput.blobUrl} controls className="mt-3 w-full" />
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">No audio loaded.</p>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">2. Pipeline</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Run each stage individually, or fire all three in sequence.</p>
          </div>
          <button
            type="button"
            onClick={() => void runFullPipeline()}
            disabled={!audioInput || sttStage.status === "running" || replyStage.status === "running" || ttsStage.status === "running"}
            className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/15 px-4 py-2 text-sm hover:bg-[var(--accent)]/25 disabled:opacity-40"
          >
            Run full pipeline
          </button>
        </div>

        <div className="mt-3 text-xs text-[var(--muted)]">
          Total round-trip: {totalLatencyMs > 0 ? `${totalLatencyMs} ms` : "—"}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <StageCard
            label="STT"
            stage={sttStage}
            controls={
              <select
                value={sttProvider}
                onChange={(event) => setSttProvider(event.target.value as SttProvider)}
                className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs"
              >
                <option value="kyutai-rust">kyutai-rust (moshi-server, streaming)</option>
                <option value="kyutai">kyutai (pytorch, batch)</option>
                <option value="openai">openai (gpt-4o-mini-transcribe)</option>
              </select>
            }
            actionLabel="Run STT"
            actionDisabled={!audioInput || sttStage.status === "running"}
            onAction={() => void runStt()}
          >
            {sttStage.result ? (
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted)]">
                  provider={sttStage.result.provider} {sttStage.result.model ? `· model=${sttStage.result.model}` : ""}
                </p>
                <p className="rounded border border-[var(--border)] bg-black/40 p-2 text-sm">
                  {sttStage.result.transcript || <span className="text-[var(--muted)]">(empty transcript)</span>}
                </p>
              </div>
            ) : sttStage.error ? (
              <p className="text-xs text-[var(--danger,#f87171)]">{sttStage.error}</p>
            ) : (
              <p className="text-xs text-[var(--muted)]">Waiting on audio input.</p>
            )}
          </StageCard>

          <StageCard
            label="Reply (LLM)"
            stage={replyStage}
            controls={
              <span className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--muted)]">
                openai · {process.env.NEXT_PUBLIC_AUDIO_REPLY_MODEL ?? "gpt-4o-mini"}
              </span>
            }
            actionLabel="Run Reply"
            actionDisabled={!sttStage.result?.transcript || replyStage.status === "running"}
            onAction={() => void runReply()}
            secondary={
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={2}
                className="w-full rounded border border-[var(--border)] bg-black/30 p-2 font-mono text-[11px] text-[var(--muted)]"
                placeholder="System prompt"
              />
            }
          >
            {replyStage.result ? (
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted)]">
                  provider={replyStage.result.provider} · model={replyStage.result.model}
                </p>
                <p className="rounded border border-[var(--border)] bg-black/40 p-2 text-sm">
                  {replyStage.result.reply}
                </p>
              </div>
            ) : replyStage.error ? (
              <p className="text-xs text-[var(--danger,#f87171)]">{replyStage.error}</p>
            ) : (
              <p className="text-xs text-[var(--muted)]">Run STT first.</p>
            )}
          </StageCard>

          <StageCard
            label="TTS"
            stage={ttsStage}
            controls={
              <select
                value={ttsProvider}
                onChange={(event) => setTtsProvider(event.target.value as TtsProvider)}
                className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs"
              >
                <option value="kyutai-rust">kyutai-rust (moshi-server, streaming)</option>
                <option value="elevenlabs">elevenlabs</option>
                <option value="openai">openai (gpt-4o-mini-tts)</option>
              </select>
            }
            actionLabel="Run TTS"
            actionDisabled={!replyStage.result?.reply || ttsStage.status === "running"}
            onAction={() => void runTts()}
          >
            {ttsStage.result ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--muted)]">
                  provider={ttsStage.result.provider} {ttsStage.result.fallbackUsed ? "· fallback=true" : ""} · {ttsStage.result.mimeType}
                </p>
                <audio src={ttsStage.result.blobUrl} controls className="w-full" />
              </div>
            ) : ttsStage.error ? (
              <p className="text-xs text-[var(--danger,#f87171)]">{ttsStage.error}</p>
            ) : (
              <p className="text-xs text-[var(--muted)]">Run Reply first.</p>
            )}
          </StageCard>
        </div>
      </section>

      <StreamingPanel />

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-medium">Raw responses</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Last server payload from each stage.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <RawPanel title="STT" raw={sttStage.raw} />
          <RawPanel title="Reply" raw={replyStage.raw} />
          <RawPanel title="TTS" raw={ttsStage.raw} />
        </div>
      </section>
    </main>
  );
}

function StageCard<T>({
  label,
  stage,
  controls,
  actionLabel,
  actionDisabled,
  onAction,
  children,
  secondary,
}: {
  label: string;
  stage: StageState<T>;
  controls?: React.ReactNode;
  actionLabel: string;
  actionDisabled: boolean;
  onAction: () => void;
  children: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-[0.08em] text-[var(--muted)]">{label}</p>
        <span
          className="rounded-full border px-2 py-0.5 font-mono text-[10px]"
          style={{ color: statusColor(stage.status), borderColor: statusColor(stage.status) }}
        >
          {statusLabel(stage.status)} {stage.latencyMs !== null ? `· ${stage.latencyMs}ms` : ""}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex-1">{controls}</div>
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs hover:bg-[var(--accent)]/20 disabled:opacity-40"
        >
          {actionLabel}
        </button>
      </div>

      {secondary ? <div className="mt-3">{secondary}</div> : null}

      <div className="mt-3 min-h-[60px]">{children}</div>
    </div>
  );
}

function RawPanel({ title, raw }: { title: string; raw: unknown }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-black/30 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">{title}</p>
      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-[var(--muted)]">
        {raw ? JSON.stringify(raw, null, 2) : "—"}
      </pre>
    </div>
  );
}
