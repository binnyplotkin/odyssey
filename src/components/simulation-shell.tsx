"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { SessionRecord, TurnRecord, VisibleWorld } from "@/types/simulation";

type IntroEnvelope = {
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

declare global {
  interface Window {
    webkitSpeechRecognition?: typeof SpeechRecognition;
    SpeechRecognition?: typeof SpeechRecognition;
  }
}

type RecognitionInstance = InstanceType<typeof SpeechRecognition>;

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
  const recognitionRef = useRef<RecognitionInstance | null>(null);

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
      const response = await fetch(`/api/sessions/${session.id}/turns`, {
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

      setSession(payload.session);
      setSuggestions(payload.turn.result.uiChoices);
      setStatusPanel(payload.turn.result.visibleState);
      setLog((current) => [
        ...current,
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
    });
  }

  function toggleVoiceInput() {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

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
