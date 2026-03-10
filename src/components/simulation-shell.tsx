"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { SessionRecord, TurnRecord, VisibleWorld } from "@/types/simulation";

type AudioDirective = {
  type: "speak" | "await-input";
  voice: string;
  text: string;
};

type TtsProvider = "openai" | "elevenlabs";

type IntroEnvelope = {
  narration: Array<{ id: string; text: string }>;
  dialogue: Array<{ id: string; speaker: string; role: string; text: string }>;
  uiChoices: string[];
  audioDirectives: AudioDirective[];
  visibleState: {
    politicalStability: number;
    publicSentiment: number;
    treasury: number;
    militaryPressure: number;
    factionInfluence: Record<string, number>;
  };
};

type SimulationBootstrap = {
  world: VisibleWorld;
  session: SessionRecord;
  intro: IntroEnvelope;
  turns: TurnRecord[];
};

type TurnEnvelope = {
  session: SessionRecord;
  turn: {
    result: {
      narration: Array<{ id: string; text: string }>;
      dialogue: Array<{ id: string; speaker: string; role: string; text: string }>;
      uiChoices: string[];
      audioDirectives: AudioDirective[];
      visibleState: {
        politicalStability: number;
        publicSentiment: number;
        treasury: number;
        militaryPressure: number;
        factionInfluence: Record<string, number>;
      };
    };
  };
};

type LogEntry =
  | { type: "narration"; id: string; text: string }
  | { type: "dialogue"; id: string; speaker: string; role: string; text: string }
  | { type: "user"; id: string; text: string };

function buildInitialLog(intro: IntroEnvelope, turns: TurnRecord[]): LogEntry[] {
  const initialLog: LogEntry[] = [
    ...intro.narration.map((item) => ({ type: "narration" as const, id: item.id, text: item.text })),
    ...intro.dialogue.map((item) => ({ type: "dialogue" as const, ...item })),
  ];

  for (const turn of turns) {
    initialLog.push({
      type: "user",
      id: `${turn.id}:input`,
      text: turn.input.text,
    });

    initialLog.push(
      ...turn.result.narration.map((item) => ({
        type: "narration" as const,
        id: item.id,
        text: item.text,
      })),
    );

    initialLog.push(
      ...turn.result.dialogue.map((item) => ({
        type: "dialogue" as const,
        id: item.id,
        speaker: item.speaker,
        role: item.role,
        text: item.text,
      })),
    );
  }

  return initialLog;
}

export function SimulationShell({ initialData }: { initialData: SimulationBootstrap }) {
  const latestTurn = initialData.turns[initialData.turns.length - 1];
  const activeRole = initialData.world.roles.find((role) => role.id === initialData.session.roleId);

  const [session, setSession] = useState<SessionRecord>(initialData.session);
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState<LogEntry[]>(() => buildInitialLog(initialData.intro, initialData.turns));
  const [suggestions, setSuggestions] = useState<string[]>(
    latestTurn?.result.uiChoices ?? initialData.intro.uiChoices,
  );
  const [statusPanel, setStatusPanel] = useState<IntroEnvelope["visibleState"]>(
    latestTurn?.result.visibleState ?? initialData.intro.visibleState,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
  const [voiceProvider, setVoiceProvider] = useState<TtsProvider>("elevenlabs");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<Array<{ text: string; voice: string }>>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);

  function decodeBase64ToBlob(base64: string, mimeType: string) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
  }

  async function playClip(params: { audioBase64: string; mimeType: string }) {
    const blob = decodeBase64ToBlob(params.audioBase64, params.mimeType);
    const src = URL.createObjectURL(blob);

    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(src);
      audioElementRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(src);
        if (audioElementRef.current === audio) {
          audioElementRef.current = null;
        }
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(src);
        if (audioElementRef.current === audio) {
          audioElementRef.current = null;
        }
        reject(new Error("Audio playback failed."));
      };

      void audio.play().catch((error: unknown) => {
        URL.revokeObjectURL(src);
        if (audioElementRef.current === audio) {
          audioElementRef.current = null;
        }
        reject(error instanceof Error ? error : new Error("Audio playback blocked."));
      });
    });
  }

  async function processAudioQueue() {
    if (isPlayingRef.current || !voiceOutputEnabled) {
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);

    try {
      while (voiceOutputEnabled && audioQueueRef.current.length > 0) {
        const item = audioQueueRef.current.shift();

        if (!item?.text?.trim()) {
          continue;
        }

        const speakResponse = await fetch("/api/audio/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: item.text,
            voice: voiceProvider === "elevenlabs" ? item.voice : "alloy",
            provider: voiceProvider,
          }),
        });

        const payload = (await speakResponse.json()) as {
          audioBase64?: string;
          mimeType?: string;
          error?: string;
        };

        if (!speakResponse.ok || !payload.audioBase64 || !payload.mimeType) {
          throw new Error(payload.error ?? "Voice output failed.");
        }

        await playClip({
          audioBase64: payload.audioBase64,
          mimeType: payload.mimeType,
        });
      }
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "Voice output failed.");
      audioQueueRef.current = [];
    } finally {
      isPlayingRef.current = false;
      setIsSpeaking(false);
    }
  }

  function enqueueTurnAudio(result: TurnEnvelope["turn"]["result"]) {
    if (!voiceOutputEnabled) {
      return;
    }

    const directiveLines = result.audioDirectives
      .filter((directive) => directive.type === "speak" && directive.text.trim())
      .map((directive) => ({ text: directive.text, voice: directive.voice || "alloy" }));

    if (directiveLines.length) {
      audioQueueRef.current.push(...directiveLines);
    } else {
      const fallbackLines = [
        ...result.narration.map((segment) => ({ text: segment.text, voice: "alloy" })),
        ...result.dialogue.map((segment) => ({
          text: `${segment.speaker}. ${segment.text}`,
          voice: "alloy",
        })),
      ];
      audioQueueRef.current.push(...fallbackLines);
    }

    void processAudioQueue();
  }

  useEffect(() => {
    if (voiceOutputEnabled) {
      return;
    }

    audioQueueRef.current = [];
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
      audioElementRef.current = null;
    }
    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, [voiceOutputEnabled]);

  useEffect(
    () => () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }

      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }

      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.currentTime = 0;
        audioElementRef.current = null;
      }
    },
    [],
  );

  function cleanupMicCapture() {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
  }

  async function blobToBase64(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error("Failed to read recorded audio."));
      reader.onloadend = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Failed to encode recorded audio."));
          return;
        }

        const base64 = reader.result.split(",")[1];

        if (!base64) {
          reject(new Error("Recorded audio was empty."));
          return;
        }

        resolve(base64);
      };

      reader.readAsDataURL(blob);
    });
  }

  async function transcribeAndSend(blob: Blob) {
    setIsTranscribing(true);

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

      if (!response.ok || !payload.transcript?.trim()) {
        throw new Error(payload.error ?? "Transcription failed.");
      }

      const transcript = payload.transcript.trim();
      setPrompt(transcript);
      await sendTurn(transcript, "voice");
    } finally {
      setIsTranscribing(false);
    }
  }

  async function sendTurn(text: string, mode: "text" | "voice") {
    if (!text.trim()) {
      return;
    }

    setError(null);
    const userEntry = {
      type: "user" as const,
      id: `${Date.now()}`,
      text,
    };

    setLog((current) => [...current, userEntry]);
    setPrompt("");

    startTransition(async () => {
      const streamingEntryId = `stream:${Date.now()}`;
      setLog((current) => [
        ...current,
        {
          type: "narration" as const,
          id: streamingEntryId,
          text: "...",
        },
      ]);

      try {
        const response = await fetch(`/api/sessions/${session.id}/turns`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            mode,
            text,
            clientTimestamp: new Date().toISOString(),
          }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          setError(payload.error ?? "Failed to process turn.");
          setLog((current) => current.filter((entry) => entry.id !== streamingEntryId));
          return;
        }

        const contentType = response.headers.get("content-type") ?? "";

        if (!contentType.includes("text/event-stream") || !response.body) {
          const payload = (await response.json()) as TurnEnvelope;
          setSession(payload.session);
          setSuggestions(payload.turn.result.uiChoices);
          setStatusPanel(payload.turn.result.visibleState);
          enqueueTurnAudio(payload.turn.result);
          setLog((current) => [
            ...current.filter((entry) => entry.id !== streamingEntryId),
            ...payload.turn.result.narration.map((item) => ({
              type: "narration" as const,
              id: item.id,
              text: item.text,
            })),
            ...payload.turn.result.dialogue.map((item) => ({
              type: "dialogue" as const,
              id: item.id,
              speaker: item.speaker,
              role: item.role,
              text: item.text,
            })),
          ]);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let donePayload: TurnEnvelope | null = null;
        let streamError: string | null = null;
        let shouldStop = false;

        const handleEventBlock = (rawBlock: string) => {
          const lines = rawBlock
            .split("\n")
            .map((line) => line.trimEnd())
            .filter((line) => line.length > 0);
          if (!lines.length) {
            return;
          }

          let eventName = "message";
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice("event:".length).trim();
              continue;
            }

            if (line.startsWith("data:")) {
              dataLines.push(line.slice("data:".length).trimStart());
            }
          }

          if (!dataLines.length) {
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(dataLines.join("\n"));
          } catch {
            return;
          }

          if (eventName === "delta") {
            const delta = (parsed as { text?: string }).text ?? "";
            if (!delta) {
              return;
            }

            setLog((current) =>
              current.map((entry) => {
                if (entry.id !== streamingEntryId || entry.type !== "narration") {
                  return entry;
                }

                return {
                  ...entry,
                  text: entry.text === "..." ? delta : `${entry.text}${delta}`,
                };
              }),
            );
            return;
          }

          if (eventName === "done") {
            donePayload = parsed as TurnEnvelope;
            shouldStop = true;
            return;
          }

          if (eventName === "error") {
            streamError = (parsed as { error?: string }).error ?? "Failed to process turn.";
            shouldStop = true;
          }
        };

        while (!shouldStop) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let eventSeparatorIndex = buffer.indexOf("\n\n");

          while (eventSeparatorIndex !== -1) {
            const eventBlock = buffer.slice(0, eventSeparatorIndex);
            buffer = buffer.slice(eventSeparatorIndex + 2);
            handleEventBlock(eventBlock);

            if (shouldStop) {
              break;
            }

            eventSeparatorIndex = buffer.indexOf("\n\n");
          }
        }

        if (streamError) {
          setError(streamError);
          setLog((current) => current.filter((entry) => entry.id !== streamingEntryId));
          return;
        }

        if (!donePayload) {
          setError("No streamed turn payload received.");
          setLog((current) => current.filter((entry) => entry.id !== streamingEntryId));
          return;
        }

        const finalizedPayload = donePayload as TurnEnvelope;
        setSession(finalizedPayload.session);
        setSuggestions(finalizedPayload.turn.result.uiChoices);
        setStatusPanel(finalizedPayload.turn.result.visibleState);
        enqueueTurnAudio(finalizedPayload.turn.result);
        setLog((current) => [
          ...current.filter((entry) => entry.id !== streamingEntryId),
          ...finalizedPayload.turn.result.narration.map((item) => ({
            type: "narration" as const,
            id: item.id,
            text: item.text,
          })),
          ...finalizedPayload.turn.result.dialogue.map((item) => ({
            type: "dialogue" as const,
            id: item.id,
            speaker: item.speaker,
            role: item.role,
            text: item.text,
          })),
        ]);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to process turn.");
        setLog((current) => current.filter((entry) => entry.id !== streamingEntryId));
      }
    });
  }

  async function toggleVoiceInput() {
    if (isTranscribing) {
      return;
    }

    if (isListening) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      } else {
        cleanupMicCapture();
        setIsListening(false);
      }
      return;
    }

    if (
      typeof window === "undefined" ||
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError("Voice capture is not available in this browser. Use chat fallback.");
      return;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      recordedChunksRef.current = [];

      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setError("Voice capture failed. Try again or use chat fallback.");
        cleanupMicCapture();
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        setIsListening(false);
      };

      recorder.onstop = () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        mediaRecorderRef.current = null;
        cleanupMicCapture();
        setIsListening(false);

        const blobType =
          recorder.mimeType || (chunks[0] instanceof Blob ? chunks[0].type : "") || "audio/webm";
        const blob = new Blob(chunks, { type: blobType });

        if (!blob.size) {
          setError("No audio captured. Try recording again.");
          return;
        }

        void transcribeAndSend(blob).catch((captureError) => {
          setError(captureError instanceof Error ? captureError.message : "Voice transcription failed.");
        });
      };

      recorder.start();
      setIsListening(true);
    } catch {
      cleanupMicCapture();
      mediaRecorderRef.current = null;
      recordedChunksRef.current = [];
      setIsListening(false);
      setError("Microphone access was denied or unavailable.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-6 text-stone-950 md:px-6 lg:px-8">
      <section className="panel rounded-[2rem] p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.32em] text-[var(--muted)]">Simulation session</p>
            <h1 className="mt-3 max-w-3xl text-3xl leading-none font-semibold md:text-5xl">{initialData.world.title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-700 md:text-base">{initialData.world.premise}</p>
          </div>
          <div className="panel-strong rounded-[1.5rem] px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-100/70">Session</p>
            <p className="mt-2 text-sm text-amber-50">{session.id}</p>
            <p className="mt-2 text-xs text-amber-100/80">State v{session.currentStateVersion}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-[var(--border)] bg-white/60 px-4 py-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Role</p>
            <p className="text-sm text-stone-800">{activeRole?.title ?? session.roleId}</p>
          </div>
          <Link
            href="/"
            className="rounded-full border border-[var(--border)] bg-white/80 px-4 py-2 text-sm text-stone-700 transition hover:border-[var(--accent)]"
          >
            Back to landing
          </Link>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="panel rounded-[2rem] p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Court transcript</p>
              <h2 className="mt-2 text-2xl">Live simulation</h2>
            </div>
            <div className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] text-[var(--muted)]">
              Session {session.id.slice(-6)}
            </div>
          </div>

          <div className="mt-6 min-h-[26rem] space-y-4 rounded-[1.75rem] bg-[rgba(255,255,255,0.58)] p-4 md:p-5">
            {!log.length ? (
              <div className="flex h-full min-h-[20rem] items-center justify-center text-center text-stone-500">
                Session has no transcript entries yet.
              </div>
            ) : (
              log.map((entry, index) => {
                const renderKey = `${entry.type}:${entry.id}:${index}`;

                if (entry.type === "user") {
                  return (
                    <div key={renderKey} className="ml-auto max-w-[80%] rounded-[1.4rem] bg-[var(--accent-strong)] px-4 py-3 text-sm text-amber-50">
                      {entry.text}
                    </div>
                  );
                }

                if (entry.type === "dialogue") {
                  return (
                    <div key={renderKey} className="max-w-[88%] rounded-[1.5rem] border border-[var(--border)] bg-white px-4 py-3">
                      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                        {entry.speaker} · {entry.role}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-stone-700">{entry.text}</p>
                    </div>
                  );
                }

                return (
                  <div key={renderKey} className="rounded-[1.6rem] bg-[rgba(119,73,38,0.08)] px-4 py-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Narrator</p>
                    <p className="mt-2 text-base leading-7 text-balance text-stone-800">{entry.text}</p>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {suggestions.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setPrompt(choice)}
                className="rounded-full border border-[var(--border)] bg-white/65 px-4 py-2 text-sm text-stone-700 transition hover:border-[var(--accent)]"
              >
                {choice}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setVoiceOutputEnabled((current) => !current)}
              className={`rounded-full px-4 py-2 text-sm font-medium text-white transition ${
                voiceOutputEnabled ? "bg-[var(--success)]" : "bg-stone-500"
              }`}
            >
              {voiceOutputEnabled ? "Voice output on" : "Voice output off"}
            </button>
            <select
              value={voiceProvider}
              onChange={(event) => setVoiceProvider(event.target.value as TtsProvider)}
              className="rounded-full border border-[var(--border)] bg-white/75 px-4 py-2 text-sm text-stone-800"
            >
              <option value="elevenlabs">ElevenLabs voice</option>
              <option value="openai">OpenAI voice</option>
            </select>
            {isSpeaking ? (
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                Speaking...
              </span>
            ) : null}
          </div>

          <form
            className="mt-6 grid gap-3 md:grid-cols-[1fr_auto_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void sendTurn(prompt, "text");
            }}
          >
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Issue a ruling, ask for counsel, or dictate a policy..."
              className="min-h-24 rounded-[1.5rem] border border-[var(--border)] bg-white/80 px-4 py-4 outline-none ring-0 placeholder:text-stone-400"
            />
            <button
              type="button"
              onClick={() => {
                void toggleVoiceInput();
              }}
              disabled={isTranscribing}
              className={`rounded-[1.5rem] px-5 py-4 text-sm font-medium text-white transition ${
                isListening ? "bg-[var(--danger)]" : "bg-[var(--success)]"
              }`}
            >
              {isListening ? "Stop recording" : isTranscribing ? "Transcribing..." : "Voice input"}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-[1.5rem] bg-[var(--accent-strong)] px-5 py-4 text-sm font-medium text-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Sending..." : "Send turn"}
            </button>
          </form>

          {error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>

        <aside className="panel rounded-[2rem] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">World status</p>

          <div className="mt-6 grid gap-4">
            {[
              ["Political stability", statusPanel.politicalStability],
              ["Public sentiment", statusPanel.publicSentiment],
              ["Treasury", statusPanel.treasury],
              ["Military pressure", statusPanel.militaryPressure],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[1.4rem] border border-[var(--border)] bg-white/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-stone-700">{label}</p>
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{value}</p>
                </div>
                <div className="mt-3 h-2 rounded-full bg-stone-200">
                  <div className="h-2 rounded-full bg-[var(--accent-strong)]" style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-[1.5rem] bg-white/55 p-4">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Faction map</p>
            <div className="mt-4 space-y-3">
              {Object.entries(statusPanel.factionInfluence).map(([faction, value]) => (
                <div key={faction}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize">{faction}</span>
                    <span className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{value}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-stone-200">
                    <div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
