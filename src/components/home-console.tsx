"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { VisibleWorld } from "@/types/simulation";

type SessionEnvelope = {
  world: VisibleWorld;
  session: {
    id: string;
    worldId: string;
    roleId: string;
    currentStateVersion: number;
  };
  intro: {
    narration: Array<{ id: string; text: string }>;
    dialogue: Array<{ id: string; speaker: string; role: string; text: string }>;
    uiChoices: string[];
    visibleState: {
      politicalStability: number;
      publicSentiment: number;
      treasury: number;
      militaryPressure: number;
      factionInfluence: Record<string, number>;
    };
  };
};

type TurnEnvelope = {
  turn: {
    result: {
      transcript: string;
      narration: Array<{ id: string; text: string }>;
      dialogue: Array<{ id: string; speaker: string; role: string; text: string }>;
      uiChoices: string[];
      visibleState: {
        politicalStability: number;
        publicSentiment: number;
        treasury: number;
        militaryPressure: number;
        factionInfluence: Record<string, number>;
      };
      event: { title: string; category: string; summary: string } | null;
    };
  };
};

declare global {
  interface Window {
    webkitSpeechRecognition?: typeof SpeechRecognition;
    SpeechRecognition?: typeof SpeechRecognition;
  }
}

type RecognitionInstance = InstanceType<typeof SpeechRecognition>;

export function HomeConsole({ initialWorlds }: { initialWorlds: VisibleWorld[] }) {
  const [selectedWorld, setSelectedWorld] = useState<VisibleWorld>(initialWorlds[0]);
  const [session, setSession] = useState<SessionEnvelope | null>(null);
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState<
    Array<
      | { type: "narration"; id: string; text: string }
      | { type: "dialogue"; id: string; speaker: string; role: string; text: string }
      | { type: "user"; id: string; text: string }
    >
  >([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [statusPanel, setStatusPanel] = useState<SessionEnvelope["intro"]["visibleState"] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<RecognitionInstance | null>(null);

  useEffect(() => {
    setSelectedWorld(initialWorlds[0]);
  }, [initialWorlds]);

  async function beginSession(worldId: string, roleId: string) {
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldId, roleId }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Failed to start session.");
        return;
      }

      const payload = (await response.json()) as SessionEnvelope;
      setSession(payload);
      setStatusPanel(payload.intro.visibleState);
      setSuggestions(payload.intro.uiChoices);
      setLog([
        ...payload.intro.narration.map((item) => ({ type: "narration" as const, ...item })),
      ]);
    });
  }

  async function sendTurn(text: string, mode: "text" | "voice") {
    if (!session || !text.trim()) {
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
      const response = await fetch(`/api/sessions/${session.session.id}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          text,
          clientTimestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Failed to process turn.");
        return;
      }

      const payload = (await response.json()) as TurnEnvelope;

      setSuggestions(payload.turn.result.uiChoices);
      setStatusPanel(payload.turn.result.visibleState);
      setLog((current) => [
        ...current,
        ...payload.turn.result.narration.map((item) => ({
          type: "narration" as const,
          ...item,
        })),
        ...payload.turn.result.dialogue.map((item) => ({
          type: "dialogue" as const,
          ...item,
        })),
      ]);
    });
  }

  function toggleVoiceInput() {
    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      setError("Speech recognition is not available in this browser. Use chat fallback.");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();

      if (transcript) {
        setPrompt(transcript);
        void sendTurn(transcript, "voice");
      }
    };
    recognition.onerror = () => {
      setError("Voice capture failed. Try again or use chat fallback.");
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-4 py-6 text-stone-950 md:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="panel rounded-[2rem] p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.32em] text-[var(--muted)]">
                Pandora&apos;s Box
              </p>
              <h1 className="mt-3 max-w-2xl text-4xl leading-none font-semibold md:text-6xl">
                Rule a living world by voice, text, and consequence.
              </h1>
            </div>
            <div className="panel-strong rounded-[1.5rem] px-4 py-3">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-100/70">
                Deployment target
              </p>
              <p className="mt-2 text-sm text-amber-50">Next.js on Vercel, Neon for state, OpenAI for voice.</p>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {initialWorlds.map((world) => (
              <button
                key={world.id}
                type="button"
                onClick={() => setSelectedWorld(world)}
                className={`rounded-[1.5rem] border px-5 py-5 text-left transition-transform duration-200 hover:-translate-y-0.5 ${
                  selectedWorld.id === world.id
                    ? "border-[var(--accent-strong)] bg-[rgba(91,47,24,0.9)] text-amber-50"
                    : "border-[var(--border)] bg-white/55"
                }`}
              >
                <p className="font-mono text-xs uppercase tracking-[0.24em] opacity-70">{world.setting}</p>
                <h2 className="mt-3 text-2xl">{world.title}</h2>
                <p className="mt-2 text-sm leading-6 opacity-85">{world.premise}</p>
              </button>
            ))}
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                Active role
              </p>
              <div className="mt-2 rounded-[1.25rem] border border-[var(--border)] bg-white/65 px-4 py-4">
                <p className="text-xl">{selectedWorld.roles[0]?.title}</p>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  {selectedWorld.roles[0]?.summary}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void beginSession(selectedWorld.id, selectedWorld.roles[0].id)}
              className="rounded-full bg-[var(--accent-strong)] px-6 py-3 text-sm font-medium text-amber-50 transition hover:bg-[var(--accent)]"
            >
              {isPending && !session ? "Preparing court..." : "Enter the world"}
            </button>
          </div>
        </div>

        <aside className="panel rounded-[2rem] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
            Simulation model
          </p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-stone-700">
            <p>The engine tracks political stability, public sentiment, treasury health, military pressure, and faction influence on every turn.</p>
            <p>Each NPC carries evolving trust, fear, loyalty, and rolling memory summaries, so the world reacts to behavior rather than fixed scripts.</p>
            <p>When Neon or OpenAI credentials are absent, the app still runs locally with in-memory persistence and deterministic fallback generation.</p>
          </div>
          <div className="mt-6 rounded-[1.5rem] bg-[rgba(84,48,25,0.92)] p-5 text-amber-50">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-amber-200/70">Reference world</p>
            <p className="mt-3 text-lg">The King</p>
            <p className="mt-2 text-sm leading-6 text-amber-50/80">
              A monarchy under strain, used as the first world pack that validates the generic engine without hard-coding its rules into the runtime.
            </p>
          </div>
        </aside>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="panel rounded-[2rem] p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                Court transcript
              </p>
              <h2 className="mt-2 text-2xl">Live simulation</h2>
            </div>
            <div className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] text-[var(--muted)]">
              {session ? `Session ${session.session.id.slice(-6)}` : "Idle"}
            </div>
          </div>

          <div className="mt-6 min-h-[26rem] space-y-4 rounded-[1.75rem] bg-[rgba(255,255,255,0.58)] p-4 md:p-5">
            {!log.length ? (
              <div className="flex h-full min-h-[20rem] items-center justify-center text-center text-stone-500">
                Start a session to hear the narrator frame the room and begin issuing decrees.
              </div>
            ) : (
              log.map((entry) => {
                if (entry.type === "user") {
                  return (
                    <div key={entry.id} className="ml-auto max-w-[80%] rounded-[1.4rem] bg-[var(--accent-strong)] px-4 py-3 text-sm text-amber-50">
                      {entry.text}
                    </div>
                  );
                }

                if (entry.type === "dialogue") {
                  return (
                    <div key={entry.id} className="max-w-[88%] rounded-[1.5rem] border border-[var(--border)] bg-white px-4 py-3">
                      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                        {entry.speaker} · {entry.role}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-stone-700">{entry.text}</p>
                    </div>
                  );
                }

                return (
                  <div key={entry.id} className="rounded-[1.6rem] bg-[rgba(119,73,38,0.08)] px-4 py-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                      Narrator
                    </p>
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
              onClick={toggleVoiceInput}
              className={`rounded-[1.5rem] px-5 py-4 text-sm font-medium text-white transition ${
                isListening ? "bg-[var(--danger)]" : "bg-[var(--success)]"
              }`}
            >
              {isListening ? "Stop voice" : "Voice input"}
            </button>
            <button
              type="submit"
              disabled={!session || isPending}
              className="rounded-[1.5rem] bg-[var(--accent-strong)] px-5 py-4 text-sm font-medium text-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Sending..." : "Send turn"}
            </button>
          </form>

          {error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>

        <aside className="panel rounded-[2rem] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
            World status
          </p>

          <div className="mt-6 grid gap-4">
            {statusPanel ? (
              [
                ["Political stability", statusPanel.politicalStability],
                ["Public sentiment", statusPanel.publicSentiment],
                ["Treasury", statusPanel.treasury],
                ["Military pressure", statusPanel.militaryPressure],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[1.4rem] border border-[var(--border)] bg-white/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-stone-700">{label}</p>
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                      {value}
                    </p>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-stone-200">
                    <div
                      className="h-2 rounded-full bg-[var(--accent-strong)]"
                      style={{ width: `${value}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.4rem] border border-dashed border-[var(--border)] px-4 py-5 text-sm text-stone-500">
                Status meters appear once a session starts.
              </div>
            )}
          </div>

          <div className="mt-6 rounded-[1.5rem] bg-white/55 p-4">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              Faction map
            </p>
            <div className="mt-4 space-y-3">
              {Object.entries(statusPanel?.factionInfluence ?? {}).map(([faction, value]) => (
                <div key={faction}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize">{faction}</span>
                    <span className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                      {value}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-stone-200">
                    <div
                      className="h-2 rounded-full bg-[var(--accent)]"
                      style={{ width: `${value}%` }}
                    />
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
