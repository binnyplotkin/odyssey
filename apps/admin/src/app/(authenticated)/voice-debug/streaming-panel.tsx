"use client";

import { useEffect, useRef, useState } from "react";
import { MOSHI_WS_URL, msgpackDecode, msgpackEncode } from "@/lib/moshi-client";

type ConnState = "idle" | "connecting" | "streaming" | "closing" | "error";

type WordEntry = {
  text: string;
  startTime: number;
  receivedAt: number;
};

type ServerMessage =
  | { type: "Step"; prs?: number[]; step_idx?: number }
  | { type: "Word"; text: string; start_time: number }
  | { type: "EndWord"; stop_time: number }
  | { type: "Marker"; id: number }
  | { type: "Ready" }
  | { type: "Error"; message?: string };

const FRAME_SIZE = 1920;
const TARGET_SAMPLE_RATE = 24000;
const PAUSE_PREDICTION_HEAD_INDEX = 2;

function stateColor(state: ConnState) {
  switch (state) {
    case "streaming":
      return "var(--success, #4ade80)";
    case "connecting":
    case "closing":
      return "var(--accent)";
    case "error":
      return "var(--danger, #f87171)";
    default:
      return "var(--muted, #71717a)";
  }
}

export default function StreamingPanel() {
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState<WordEntry[]>([]);
  const [vadPause, setVadPause] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [framesSent, setFramesSent] = useState(0);
  const [firstWordLatencyMs, setFirstWordLatencyMs] = useState<number | null>(null);
  const [contextSampleRate, setContextSampleRate] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const startedAtRef = useRef<number>(0);
  const firstWordCapturedRef = useRef(false);

  useEffect(() => {
    return () => {
      void teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function teardown() {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      try {
        workletNodeRef.current.disconnect();
      } catch {
        /* ignore */
      }
      workletNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        /* ignore */
      }
      sourceNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {
        /* ignore */
      }
      audioContextRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
    setMicLevel(0);
  }

  function handleServerMessage(message: ServerMessage) {
    if (message.type === "Word") {
      const receivedAt = performance.now();
      if (!firstWordCapturedRef.current) {
        firstWordCapturedRef.current = true;
        setFirstWordLatencyMs(Math.round(receivedAt - startedAtRef.current));
      }
      setWords((current) => [
        ...current,
        {
          text: message.text,
          startTime: message.start_time,
          receivedAt,
        },
      ]);
    } else if (message.type === "Step") {
      const prs = message.prs;
      if (Array.isArray(prs) && prs.length > PAUSE_PREDICTION_HEAD_INDEX) {
        setVadPause(prs[PAUSE_PREDICTION_HEAD_INDEX]);
      }
    } else if (message.type === "Error") {
      setError(message.message ?? "Server error");
      setState("error");
    }
  }

  async function startStreaming() {
    setError(null);
    setWords([]);
    setVadPause(0);
    setFramesSent(0);
    setFirstWordLatencyMs(null);
    firstWordCapturedRef.current = false;
    setState("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      setContextSampleRate(audioContext.sampleRate);

      await audioContext.audioWorklet.addModule("/audio-worklet/pcm-capture-worklet.js");

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const node = new AudioWorkletNode(audioContext, "pcm-capture-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      workletNodeRef.current = node;

      const ws = new WebSocket(MOSHI_WS_URL);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        startedAtRef.current = performance.now();
        setState("streaming");

        // 1 second of leading silence — required by some Kyutai STT models
        // and harmless for the 1B en_fr default.
        const silence = new Float32Array(TARGET_SAMPLE_RATE);
        ws.send(
          msgpackEncode({
            type: "Audio",
            pcm: Array.from(silence),
          }),
        );

        node.port.onmessage = (event) => {
          const data = event.data as
            | { type: "frame"; samples: Float32Array }
            | { type: "level"; rms: number };
          if (data.type === "frame") {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(
              msgpackEncode({
                type: "Audio",
                pcm: Array.from(data.samples),
              }),
            );
            setFramesSent((current) => current + 1);
          } else if (data.type === "level") {
            setMicLevel(data.rms);
          }
        };

        source.connect(node);
      };

      ws.onmessage = (event) => {
        try {
          const data = msgpackDecode(new Uint8Array(event.data as ArrayBuffer)) as ServerMessage;
          handleServerMessage(data);
        } catch (decodeError) {
          console.error("Failed to decode WS message", decodeError);
        }
      };

      ws.onerror = () => {
        setError("WebSocket error — see browser console.");
        setState("error");
      };

      ws.onclose = (event) => {
        if (state === "streaming" && !event.wasClean) {
          setError(`WebSocket closed: code=${event.code} reason=${event.reason || "(none)"}`);
          setState("error");
        }
      };
    } catch (startError) {
      const detail = startError instanceof Error ? startError.message : "Failed to start streaming.";
      setError(detail);
      setState("error");
      void teardown();
    }
  }

  async function stopStreaming() {
    setState("closing");
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        // Trailing silence + marker so the server flushes pending words.
        const silence = new Float32Array(TARGET_SAMPLE_RATE);
        for (let i = 0; i < 2; i += 1) {
          wsRef.current.send(
            msgpackEncode({
              type: "Audio",
              pcm: Array.from(silence),
            }),
          );
        }
        wsRef.current.send(msgpackEncode({ type: "Marker", id: 0 }));
      } catch {
        /* ignore */
      }
    }
    await new Promise((r) => setTimeout(r, 600));
    await teardown();
    setState("idle");
  }

  const transcript = words.map((w) => w.text).join(" ");
  const elapsed = state === "streaming" && startedAtRef.current
    ? Math.max(0, performance.now() - startedAtRef.current)
    : 0;

  const micPercent = Math.max(0, Math.min(100, Math.round(micLevel * 1200)));
  const vadPercent = Math.max(0, Math.min(100, Math.round(vadPause * 100)));

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">3. Streaming (Kyutai Rust)</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Live word-by-word transcripts via WebSocket to moshi-server. Browser captures PCM at
            24 kHz, streams to Modal, words appear as you speak with the model&apos;s ~0.5s delay.
          </p>
        </div>
        <span
          className="rounded-full border px-3 py-1 font-mono text-[10px]"
          style={{ color: stateColor(state), borderColor: stateColor(state) }}
        >
          {state.toUpperCase()}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {state === "idle" || state === "error" ? (
          <button
            type="button"
            onClick={() => void startStreaming()}
            className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/15 px-4 py-2 text-sm hover:bg-[var(--accent)]/25"
          >
            ● Start streaming
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void stopStreaming()}
            disabled={state === "closing" || state === "connecting"}
            className="rounded-lg border border-[var(--danger,#f87171)] bg-[var(--danger,#f87171)]/10 px-4 py-2 text-sm text-[var(--danger,#f87171)] disabled:opacity-50"
          >
            ■ Stop
          </button>
        )}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--danger,#f87171)] bg-[var(--danger,#f87171)]/10 px-3 py-2 text-sm text-[var(--danger,#f87171)]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">Live transcript</p>
          <div className="mt-3 min-h-[120px] rounded border border-[var(--border)] bg-black/40 p-3 text-sm leading-relaxed">
            {transcript || (
              <span className="text-[var(--muted)]">
                {state === "streaming" ? "Listening… start talking." : "Idle."}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
            <span>Words: {words.length}</span>
            <span>Frames sent: {framesSent}</span>
            <span>
              First-word latency: {firstWordLatencyMs !== null ? `${firstWordLatencyMs} ms` : "—"}
            </span>
            <span>Elapsed: {elapsed > 0 ? `${Math.round(elapsed)} ms` : "—"}</span>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">Live signals</p>

          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>Mic level (RMS)</span>
              <span>{micPercent}%</span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-black/30">
              <div
                className="h-2 rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${micPercent}%` }}
              />
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>Pause prediction (head 2 = 2.0 s)</span>
              <span>{vadPercent}%</span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-black/30">
              <div
                className="h-2 rounded-full bg-[var(--success,#4ade80)] transition-all"
                style={{ width: `${vadPercent}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-[var(--muted)]">
              Server&apos;s semantic VAD probability that the user paused for ~2s. Cross 50% = end of utterance.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-[var(--muted)]">
            <div className="rounded border border-[var(--border)] bg-black/30 p-2">
              <p className="font-mono uppercase tracking-[0.08em]">Source rate</p>
              <p>{contextSampleRate ? `${contextSampleRate} Hz` : "—"}</p>
            </div>
            <div className="rounded border border-[var(--border)] bg-black/30 p-2">
              <p className="font-mono uppercase tracking-[0.08em]">Target rate</p>
              <p>{TARGET_SAMPLE_RATE} Hz</p>
            </div>
            <div className="rounded border border-[var(--border)] bg-black/30 p-2">
              <p className="font-mono uppercase tracking-[0.08em]">Frame size</p>
              <p>{FRAME_SIZE} samples · 80 ms</p>
            </div>
            <div className="rounded border border-[var(--border)] bg-black/30 p-2">
              <p className="font-mono uppercase tracking-[0.08em]">Endpoint</p>
              <p className="truncate">moshi-server (modal)</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
