"use client";

import { useEffect, useState } from "react";

type IntroEnvelope = {
  world: { title: string; setting: string; premise: string };
  intro: {
    narration: Array<{ text: string }>;
    uiChoices: string[];
  };
};

type TurnEnvelope = {
  turn: {
    result: {
      narration: Array<{ text: string }>;
      dialogue: Array<{ speaker: string; text: string }>;
      uiChoices: string[];
      event: { title: string; summary: string } | null;
    };
  };
};

export function WorldSimulationConsole({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sceneTitle, setSceneTitle] = useState("");
  const [sceneSetting, setSceneSetting] = useState("");
  const [sceneNarration, setSceneNarration] = useState<string[]>([]);
  const [sceneDialogue, setSceneDialogue] = useState<Array<{ speaker: string; text: string }>>([]);
  const [choices, setChoices] = useState<string[]>([]);
  const [responseDraft, setResponseDraft] = useState("");
  const [eventSummary, setEventSummary] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
        const payload = (await response.json()) as IntroEnvelope | { error?: string };
        if (!response.ok) {
          setError((payload as { error?: string }).error ?? "Failed to load simulation scene.");
          return;
        }
        const intro = payload as IntroEnvelope;
        setSceneTitle(intro.world.title);
        setSceneSetting(intro.world.setting);
        setSceneNarration(intro.intro.narration.map((item) => item.text));
        setChoices(intro.intro.uiChoices);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  async function submitTurn() {
    if (!responseDraft.trim() || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "text",
          text: responseDraft,
          clientTimestamp: new Date().toISOString(),
        }),
      });
      const payload = (await response.json()) as TurnEnvelope | { error?: string };
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "Failed to process world turn.");
        return;
      }

      const turn = payload as TurnEnvelope;
      setSceneNarration(turn.turn.result.narration.map((item) => item.text));
      setSceneDialogue(turn.turn.result.dialogue.map((item) => ({
        speaker: item.speaker,
        text: item.text,
      })));
      setChoices(turn.turn.result.uiChoices);
      setEventSummary(
        turn.turn.result.event
          ? `${turn.turn.result.event.title}: ${turn.turn.result.event.summary}`
          : null,
      );
      setResponseDraft("");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return <main className="p-8 text-sm text-stone-700">Loading simulation...</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <section className="panel rounded-[2rem] p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--text-tertiary)]">World Simulation</p>
        <h1 className="mt-3 text-3xl font-semibold text-stone-900 md:text-5xl">{sceneTitle}</h1>
        <p className="mt-3 text-sm leading-7 text-stone-700">{sceneSetting}</p>
      </section>

      {error ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="panel rounded-[2rem] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--text-tertiary)]">Scene Narration</p>
          <div className="mt-3 space-y-3 text-sm leading-7 text-stone-800">
            {sceneNarration.map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
            ))}
          </div>

          {sceneDialogue.length > 0 ? (
            <div className="mt-5 rounded-xl border border-[var(--border)] bg-white/70 p-4">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Dynamic Responses</p>
              <div className="mt-2 space-y-2 text-sm text-stone-700">
                {sceneDialogue.map((line) => (
                  <p key={`${line.speaker}-${line.text}`}>
                    <span className="font-semibold text-stone-900">{line.speaker}: </span>
                    {line.text}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {eventSummary ? (
            <p className="mt-4 text-sm text-stone-700">
              <span className="font-semibold text-stone-900">Historical event in play: </span>
              {eventSummary}
            </p>
          ) : null}
        </article>

        <aside className="panel rounded-[2rem] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--text-tertiary)]">Actions</p>
          <div className="mt-3 space-y-2 text-sm text-stone-700">
            {choices.map((choice) => (
              <p key={choice}>• {choice}</p>
            ))}
          </div>

          <p className="mt-5 font-mono text-xs uppercase tracking-[0.24em] text-[var(--text-tertiary)]">Your Move</p>
          <textarea
            value={responseDraft}
            onChange={(event) => setResponseDraft(event.target.value)}
            placeholder="Describe your action or response..."
            className="mt-3 min-h-40 w-full rounded-[1rem] border border-[var(--border)] bg-white/80 px-4 py-4 text-sm leading-7 outline-none"
          />
          <button
            type="button"
            onClick={submitTurn}
            disabled={isSubmitting || !responseDraft.trim()}
            className="mt-4 rounded-full bg-[var(--accent-strong)] px-5 py-2.5 text-sm font-medium text-amber-50 transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Simulating..." : "Advance Simulation"}
          </button>
        </aside>
      </section>
    </main>
  );
}
