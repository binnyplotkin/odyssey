"use client";

import { useEffect, useRef, useState } from "react";

type ProbeResult = {
  name: string;
  ok: boolean;
  detail: string;
  at: string;
};

type TurnRecord = {
  id: string;
  userText: string;
  assistantText: string;
  latencyMs: number;
  at: string;
};

type SpeakPayload = {
  audioBase64?: string;
  mimeType?: string;
  provider?: string;
  fallbackUsed?: boolean;
  error?: string;
  details?: string[];
};

type ReplyPayload = {
  reply?: string;
  model?: string;
  error?: string;
};

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
] as const;

const TURN_MIN_MS = 700;
const TURN_MAX_MS = 15000;
const SILENCE_HOLD_MS = 900;
const VAD_THRESHOLD = 0.028;

function nowLabel() {
  return new Date().toLocaleTimeString();
}

function resolveRecorderMimeType() {
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

async function blobToBase64(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read recorded audio."));
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Invalid audio encoding result."));
        return;
      }
      const encoded = reader.result.split(",")[1];
      if (!encoded) {
        reject(new Error("Audio blob produced empty base64."));
        return;
      }
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

export default function VoiceTest4Page() {
  const [sessionActive, setSessionActive] = useState(false);
  const [phase, setPhase] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [lastModel, setLastModel] = useState("");
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [checks, setChecks] = useState<ProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const vadTimerRef = useRef<number | null>(null);
  const sessionActiveRef = useRef(false);
  const processingRef = useRef(false);
  const speechDetectedRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const turnStartedAtRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  function addCheck(entry: ProbeResult) {
    setChecks((current) => [entry, ...current].slice(0, 18));
  }

  function clearVadTimer() {
    if (vadTimerRef.current !== null) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  }

  function cleanupMedia() {
    clearVadTimer();

    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
      audioElementRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore shutdown race.
      }
    }
    mediaRecorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    chunksRef.current = [];
    processingRef.current = false;
    sessionActiveRef.current = false;
    speechDetectedRef.current = false;
    setMicLevel(0);
  }

  async function runChecks() {
    try {
      const [health, config] = await Promise.all([
        fetch("/api/healthz", { cache: "no-store" }),
        fetch("/api/audio/config", { cache: "no-store" }),
      ]);

      addCheck({
        name: "GET /api/healthz",
        ok: health.ok,
        detail: `${health.status} ${(await health.text()).slice(0, 120)}`,
        at: nowLabel(),
      });

      addCheck({
        name: "GET /api/audio/config",
        ok: config.ok,
        detail: `${config.status} ${(await config.text()).slice(0, 180)}`,
        at: nowLabel(),
      });
    } catch (checkError) {
      addCheck({
        name: "startup checks",
        ok: false,
        detail: checkError instanceof Error ? checkError.message : "Startup checks failed.",
        at: nowLabel(),
      });
    }
  }

  function sampleMicLevel() {
    const analyser = analyserRef.current;
    if (!analyser) {
      return 0;
    }

    const timeData = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeData);

    let rms = 0;
    for (let i = 0; i < timeData.length; i += 1) {
      const normalized = (timeData[i] - 128) / 128;
      rms += normalized * normalized;
    }

    return Math.sqrt(rms / timeData.length);
  }

  async function transcribeBlob(blob: Blob) {
    const audioBase64 = await blobToBase64(blob);
    const response = await fetch("/api/audio/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64,
        mimeType: blob.type || "audio/webm",
      }),
    });

    const payload = (await response.json()) as { transcript?: string; error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Transcription failed.");
    }

    const transcript = (payload.transcript ?? "").trim();
    if (!transcript) {
      throw new Error("Transcription returned empty text.");
    }

    addCheck({
      name: "POST /api/audio/transcribe",
      ok: true,
      detail: `200 transcript: ${transcript.slice(0, 120)}`,
      at: nowLabel(),
    });

    return transcript;
  }

  async function generateReply(transcript: string) {
    const response = await fetch("/api/audio/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    });

    const payload = (await response.json()) as ReplyPayload;
    if (!response.ok || !payload.reply) {
      throw new Error(payload.error ?? "Reply generation failed.");
    }

    addCheck({
      name: "POST /api/audio/reply",
      ok: true,
      detail: `200 model=${payload.model ?? "unknown"} reply: ${payload.reply.slice(0, 100)}`,
      at: nowLabel(),
    });

    return {
      reply: payload.reply,
      model: payload.model ?? "",
    };
  }

  async function speakText(text: string) {
    const response = await fetch("/api/audio/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        provider: "openai",
      }),
    });

    const payload = (await response.json()) as SpeakPayload;
    if (!response.ok || !payload.audioBase64 || !payload.mimeType) {
      const detail = payload.error ?? payload.details?.join(" | ") ?? "Unknown TTS failure.";
      throw new Error(detail);
    }

    const blob = decodeBase64ToBlob(payload.audioBase64, payload.mimeType);
    const src = URL.createObjectURL(blob);
    const audio = new Audio(src);
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.preload = "auto";
    audioElementRef.current = audio;

    try {
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(src);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(src);
          reject(new Error("Audio playback failed."));
        };

        void audio.play().catch((playError) => {
          URL.revokeObjectURL(src);
          reject(playError instanceof Error ? playError : new Error("Audio playback blocked."));
        });
      });

      addCheck({
        name: "POST /api/audio/speak",
        ok: true,
        detail: "200 audio payload received and played.",
        at: nowLabel(),
      });
    } catch (playbackError) {
      const detail =
        playbackError instanceof Error
          ? playbackError.message
          : "Audio playback blocked by browser policy.";
      const blockedByPolicy =
        detail.includes("not allowed by the user agent") ||
        detail.toLowerCase().includes("notallowederror");

      addCheck({
        name: "POST /api/audio/speak",
        ok: false,
        detail: blockedByPolicy
          ? "Audio returned but browser blocked autoplay. Tap page and keep tab active."
          : detail,
        at: nowLabel(),
      });

      // Do not fail the turn loop for playback-policy issues.
      if (!blockedByPolicy) {
        throw playbackError;
      }
    }
  }

  async function finalizeTurn() {
    if (processingRef.current) {
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }

    processingRef.current = true;
    clearVadTimer();
    setPhase("processing");

    const elapsedMs = Date.now() - turnStartedAtRef.current;

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      };
      try {
        recorder.requestData();
      } catch {
        // Ignore unsupported requestData implementations.
      }
      recorder.stop();
    });

    if (!speechDetectedRef.current || elapsedMs < TURN_MIN_MS || blob.size < 1024) {
      processingRef.current = false;
      chunksRef.current = [];
      speechDetectedRef.current = false;

      if (stopRequestedRef.current || !sessionActiveRef.current) {
        setPhase("idle");
        return;
      }

      setPhase("listening");
      startTurnRecording();
      return;
    }

    try {
      const startedAt = performance.now();
      const transcript = await transcribeBlob(blob);
      setLastTranscript(transcript);

      const replyResult = await generateReply(transcript);
      setLastReply(replyResult.reply);
      setLastModel(replyResult.model);

      setPhase("speaking");
      await speakText(replyResult.reply);

      setTurns((current) => [
        {
          id: crypto.randomUUID(),
          userText: transcript,
          assistantText: replyResult.reply,
          latencyMs: Math.round(performance.now() - startedAt),
          at: nowLabel(),
        },
        ...current,
      ].slice(0, 20));
    } catch (turnError) {
      const detail = turnError instanceof Error ? turnError.message : "Voice turn failed.";
      setError(detail);
      addCheck({
        name: "Voice turn",
        ok: false,
        detail,
        at: nowLabel(),
      });
    } finally {
      processingRef.current = false;
      chunksRef.current = [];
      speechDetectedRef.current = false;

      if (stopRequestedRef.current || !sessionActiveRef.current) {
        setPhase("idle");
        return;
      }

      setPhase("listening");
      startTurnRecording();
    }
  }

  function startTurnRecording() {
    const stream = streamRef.current;
    if (!stream || processingRef.current || !sessionActiveRef.current) {
      return;
    }

    const mimeType = resolveRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    chunksRef.current = [];
    speechDetectedRef.current = false;
    lastSpeechAtRef.current = Date.now();
    turnStartedAtRef.current = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    try {
      recorder.start(250);
    } catch (recorderStartError) {
      const detail =
        recorderStartError instanceof Error
          ? recorderStartError.message
          : "Recorder failed to start.";
      setError(detail);
      addCheck({
        name: "Recorder",
        ok: false,
        detail,
        at: nowLabel(),
      });
      setSessionActive(false);
      sessionActiveRef.current = false;
      setPhase("idle");
      return;
    }
    mediaRecorderRef.current = recorder;

    clearVadTimer();
    vadTimerRef.current = window.setInterval(() => {
      const level = sampleMicLevel();
      setMicLevel(level);

      const now = Date.now();
      if (level > VAD_THRESHOLD) {
        speechDetectedRef.current = true;
        lastSpeechAtRef.current = now;
      }

      const elapsed = now - turnStartedAtRef.current;
      const silenceFor = now - lastSpeechAtRef.current;
      const shouldFinalizeBySilence = speechDetectedRef.current && elapsed >= TURN_MIN_MS && silenceFor >= SILENCE_HOLD_MS;
      const shouldFinalizeByMax = elapsed >= TURN_MAX_MS;

      if (shouldFinalizeBySilence || shouldFinalizeByMax) {
        void finalizeTurn();
      }
    }, 120);
  }

  async function startLiveSession() {
    setError(null);
    stopRequestedRef.current = false;

    try {
      await runChecks();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      await audioContext.resume();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      setSessionActive(true);
      sessionActiveRef.current = true;
      setPhase("listening");
      startTurnRecording();
    } catch (startError) {
      const detail = startError instanceof Error ? startError.message : "Failed to start live session.";
      setError(detail);
      setSessionActive(false);
      sessionActiveRef.current = false;
      setPhase("idle");
      cleanupMedia();
    }
  }

  function stopLiveSession() {
    stopRequestedRef.current = true;
    setSessionActive(false);
    sessionActiveRef.current = false;
    setPhase("idle");
    cleanupMedia();
  }

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
      cleanupMedia();
    };
  }, []);

  const micPercent = Math.max(0, Math.min(100, Math.round(micLevel * 1200)));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Tools</p>
        <h1 className="mt-2 text-3xl font-semibold">Voice Test 4</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Live conversation mode: continuous listening with automatic end-of-speech detection, then STT, AI reply, and spoken playback.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-medium">Live Session</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">State machine: listening - processing - speaking - listening.</p>

          <div className="mt-4 flex gap-2">
            {!sessionActive ? (
              <button
                type="button"
                onClick={() => void startLiveSession()}
                className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2 text-sm transition hover:bg-[var(--accent)]/20"
              >
                Start live session
              </button>
            ) : (
              <button
                type="button"
                onClick={stopLiveSession}
                className="rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]"
              >
                Stop live session
              </button>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Phase</p>
            <p className="mt-1 text-sm">{phase}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Mic level</p>
            <div className="mt-2 h-2 w-full rounded-full bg-black/30">
              <div
                className="h-2 rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${micPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{micPercent}%</p>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="rounded-lg border border-[var(--border)] bg-black/30 p-3">
              <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Last transcript</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{lastTranscript || "Waiting for speech..."}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-black/30 p-3">
              <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Last reply</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{lastReply || "No assistant reply yet."}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">{lastModel ? `model=${lastModel}` : ""}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-medium">Recent Probe Results</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Latest route checks and runtime failures.</p>
          <div className="mt-4 flex max-h-80 flex-col gap-2 overflow-auto">
            {checks.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No checks yet.</p>
            ) : (
              checks.map((check) => (
                <div
                  key={`${check.name}:${check.at}:${check.detail}`}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono uppercase tracking-[0.08em] text-[var(--muted)]">{check.name}</span>
                    <span className={check.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                      {check.ok ? "PASS" : "FAIL"} · {check.at}
                    </span>
                  </div>
                  <p className="mt-1 text-[var(--muted)]">{check.detail}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-medium">Turn History</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Most recent live turns with total loop latency.</p>
        <div className="mt-4 flex max-h-80 flex-col gap-3 overflow-auto">
          {turns.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No turns yet.</p>
          ) : (
            turns.map((turn) => (
              <article
                key={turn.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4"
              >
                <p className="text-xs text-[var(--muted)]">{turn.at} · {turn.latencyMs} ms</p>
                <p className="mt-2 text-sm"><span className="text-[var(--muted)]">You:</span> {turn.userText}</p>
                <p className="mt-2 text-sm"><span className="text-[var(--muted)]">AI:</span> {turn.assistantText}</p>
              </article>
            ))
          )}
        </div>
      </section>

      {error ? (
        <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </main>
  );
}
