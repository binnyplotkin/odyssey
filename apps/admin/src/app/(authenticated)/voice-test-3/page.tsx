"use client";

import { useEffect, useRef, useState } from "react";

type ProbeResult = {
  name: string;
  ok: boolean;
  detail: string;
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

function nowLabel() {
  return new Date().toLocaleTimeString();
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

export default function VoiceTest3Page() {
  const [checks, setChecks] = useState<ProbeResult[]>([]);
  const [configJson, setConfigJson] = useState<string>("");
  const [ttsText, setTtsText] = useState("Testing Odyssey TTS from Voice Test 3.");
  const [transcript, setTranscript] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyModel, setReplyModel] = useState("");
  const [lastTtsInfo, setLastTtsInfo] = useState("");
  const [lastLoopLatencyMs, setLastLoopLatencyMs] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | "checks" | "tts" | "stt" | "reply" | "loop">(null);
  const [recording, setRecording] = useState(false);
  const [preparingMic, setPreparingMic] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartedAtRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  function addCheck(result: ProbeResult) {
    setChecks((current) => [result, ...current].slice(0, 12));
  }

  async function runChecks() {
    setBusy("checks");
    setError(null);
    try {
      const [health, config] = await Promise.all([
        fetch("/api/healthz", { cache: "no-store" }),
        fetch("/api/audio/config", { cache: "no-store" }),
      ]);

      const healthText = await health.text();
      addCheck({
        name: "GET /api/healthz",
        ok: health.ok,
        detail: `${health.status} ${healthText.slice(0, 140)}`,
        at: nowLabel(),
      });

      const configText = await config.text();
      addCheck({
        name: "GET /api/audio/config",
        ok: config.ok,
        detail: `${config.status} ${configText.slice(0, 200)}`,
        at: nowLabel(),
      });

      setConfigJson(configText);
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Health/config checks failed.");
    } finally {
      setBusy(null);
    }
  }

  async function testTts(inputText?: string) {
    const text = (inputText ?? ttsText).trim();
    if (!text) {
      setError("Enter text before TTS test.");
      return;
    }

    setBusy("tts");
    setError(null);
    try {
      await synthesizeAndPlay(text);
    } catch (ttsError) {
      const detail = ttsError instanceof Error ? ttsError.message : "TTS test failed.";
      setError(detail);
      addCheck({
        name: "POST /api/audio/speak",
        ok: false,
        detail,
        at: nowLabel(),
      });
    } finally {
      setBusy(null);
    }
  }

  async function synthesizeAndPlay(text: string) {
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
    audio.onended = () => URL.revokeObjectURL(src);
    audio.onerror = () => URL.revokeObjectURL(src);
    await audio.play();

    setLastTtsInfo(
      `provider=${payload.provider ?? "unknown"} fallback=${String(payload.fallbackUsed ?? false)}`,
    );

    addCheck({
      name: "POST /api/audio/speak",
      ok: true,
      detail: "200 audio payload received and played.",
      at: nowLabel(),
    });
  }

  async function generateReply(inputText?: string) {
    const text = (inputText ?? transcript).trim();
    if (!text) {
      throw new Error("Transcript is empty. Record and transcribe first.");
    }

    const response = await fetch("/api/audio/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: text }),
    });

    const payload = (await response.json()) as ReplyPayload;
    if (!response.ok || !payload.reply) {
      throw new Error(payload.error ?? "Reply generation failed.");
    }

    setReplyText(payload.reply);
    setReplyModel(payload.model ?? "");

    addCheck({
      name: "POST /api/audio/reply",
      ok: true,
      detail: `200 model=${payload.model ?? "unknown"} reply: ${payload.reply.slice(0, 100)}`,
      at: nowLabel(),
    });

    return payload.reply;
  }

  async function testReply() {
    setBusy("reply");
    setError(null);
    try {
      await generateReply();
    } catch (replyError) {
      const detail = replyError instanceof Error ? replyError.message : "Reply generation failed.";
      setError(detail);
      addCheck({
        name: "POST /api/audio/reply",
        ok: false,
        detail,
        at: nowLabel(),
      });
    } finally {
      setBusy(null);
    }
  }

  async function runFullLoop() {
    setBusy("loop");
    setError(null);
    setLastLoopLatencyMs(null);
    const startedAt = performance.now();

    try {
      const reply = await generateReply();
      await synthesizeAndPlay(reply);
      setLastLoopLatencyMs(Math.round(performance.now() - startedAt));
    } catch (loopError) {
      const detail = loopError instanceof Error ? loopError.message : "Full loop failed.";
      setError(detail);
      if (!detail.includes("POST /api/audio/reply")) {
        addCheck({
          name: "Voice loop",
          ok: false,
          detail,
          at: nowLabel(),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  async function transcribeBlob(blob: Blob) {
    setBusy("stt");
    setError(null);
    try {
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

      const text = (payload.transcript ?? "").trim();
      setTranscript(text);
      if (text) {
        setTtsText(text);
      }

      addCheck({
        name: "POST /api/audio/transcribe",
        ok: true,
        detail: text ? `200 transcript: ${text.slice(0, 120)}` : "200 but empty transcript.",
        at: nowLabel(),
      });
    } catch (sttError) {
      const detail = sttError instanceof Error ? sttError.message : "Transcription failed.";
      setError(detail);
      addCheck({
        name: "POST /api/audio/transcribe",
        ok: false,
        detail,
        at: nowLabel(),
      });
    } finally {
      setBusy(null);
    }
  }

  async function startRecording() {
    try {
      setError(null);
      setPreparingMic(true);

      const stream =
        streamRef.current ??
        (await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }));
      streamRef.current = stream;

      const mimeType = resolveRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      // Request chunk callbacks periodically for better browser compatibility.
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      setRecording(true);
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : "Failed to access microphone.");
    } finally {
      setPreparingMic(false);
    }
  }

  async function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      return;
    }

    setRecording(false);
    const elapsedMs = Date.now() - recordingStartedAtRef.current;
    if (elapsedMs < 350) {
      setError("Recording was too short. Hold recording for at least half a second.");
      addCheck({
        name: "POST /api/audio/transcribe",
        ok: false,
        detail: "Recording too short to produce audio payload.",
        at: nowLabel(),
      });
      return;
    }

    try {
      recorder.requestData();
    } catch {
      // Some browsers throw if requestData is unsupported mid-stop; safe to ignore.
    }

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.stop();
    });

    if (!blob.size) {
      setError("No audio captured. Please retry and speak while recording.");
      addCheck({
        name: "POST /api/audio/transcribe",
        ok: false,
        detail: "Recorder stopped with empty audio blob.",
        at: nowLabel(),
      });
      return;
    }

    await transcribeBlob(blob);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Tools</p>
        <h1 className="mt-2 text-3xl font-semibold">Voice Test 3</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--text-tertiary)]">
          Baseline validation harness for managed audio path: health, config, STT, and TTS.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-medium">1) Service Checks</h2>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">Verify deployment and audio config routes.</p>
          <button
            type="button"
            onClick={() => void runChecks()}
            disabled={busy !== null}
            className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 text-sm transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "checks" ? "Running checks..." : "Run health + config"}
          </button>
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-black/30 p-3 text-xs text-[var(--text-tertiary)]">
            {configJson || "No config loaded yet."}
          </pre>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-medium">2) Text-to-Speech</h2>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">Calls POST /api/audio/speak and plays returned audio.</p>
          <textarea
            value={ttsText}
            onChange={(event) => setTtsText(event.target.value)}
            className="mt-4 min-h-28 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-sm"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void testTts()}
              disabled={busy !== null}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 text-sm transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "tts" ? "Synthesizing..." : "Test TTS"}
            </button>
          </div>
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">{lastTtsInfo || "No TTS response yet."}</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-medium">3) Speech-to-Text</h2>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">
            Record microphone audio, transcribe, then run AI reply and playback.
          </p>
          <div className="mt-4 flex gap-2">
            {!recording ? (
              <button
                type="button"
                onClick={() => void startRecording()}
                disabled={busy !== null || preparingMic}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 text-sm transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {preparingMic ? "Preparing mic..." : "Start recording"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void stopRecording()}
                className="rounded-lg border border-[var(--status-error)] bg-[var(--status-error)]/10 px-4 py-2 text-sm text-[var(--status-error)]"
              >
                Stop + transcribe
              </button>
            )}
            <button
              type="button"
              onClick={() => void testTts(transcript)}
              disabled={!transcript.trim() || busy !== null}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 text-sm transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Speak transcript
            </button>
            <button
              type="button"
              onClick={() => void testReply()}
              disabled={!transcript.trim() || busy !== null}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 text-sm transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "reply" ? "Generating..." : "Generate AI reply"}
            </button>
            <button
              type="button"
              onClick={() => void runFullLoop()}
              disabled={!transcript.trim() || busy !== null}
              className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2 text-sm transition hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "loop" ? "Running loop..." : "AI reply + speak"}
            </button>
          </div>
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-black/30 p-3 text-xs text-[var(--text-tertiary)]">
            {transcript || "No transcript yet."}
          </pre>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            {replyText
              ? `Reply model=${replyModel || "unknown"}${
                lastLoopLatencyMs ? ` · full loop ${lastLoopLatencyMs} ms` : ""
              }`
              : "No AI reply yet."}
          </p>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-black/30 p-3 text-xs text-[var(--text-tertiary)]">
            {replyText || "AI reply will appear here."}
          </pre>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-medium">Recent Probe Results</h2>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">Most recent checks and failures.</p>
          <div className="mt-4 flex max-h-72 flex-col gap-2 overflow-auto">
            {checks.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">No checks run yet.</p>
            ) : (
              checks.map((check) => (
                <div
                  key={`${check.name}:${check.at}:${check.detail}`}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{check.name}</span>
                    <span className={check.ok ? "text-[var(--status-live)]" : "text-[var(--status-error)]"}>
                      {check.ok ? "PASS" : "FAIL"} · {check.at}
                    </span>
                  </div>
                  <p className="mt-1 text-[var(--text-tertiary)]">{check.detail}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {error ? (
        <p className="rounded-lg border border-[var(--status-error)] bg-[var(--status-error)]/10 px-4 py-3 text-sm text-[var(--status-error)]">
          {error}
        </p>
      ) : null}
    </main>
  );
}
