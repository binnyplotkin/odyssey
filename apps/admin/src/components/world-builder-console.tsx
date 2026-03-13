"use client";

import { useState, useTransition } from "react";
import { VisibleWorld, WorldDefinition } from "@odyssey/types";

type BuildWorldResponse = {
  world: VisibleWorld;
  worldId: string;
  roleId: string;
  published: true;
};

type WorldDetailResponse = {
  source: "static" | "dynamic";
  editable: boolean;
  world: WorldDefinition;
  record: {
    id: string;
    version: number;
    updatedAt: string;
  } | null;
};

export function WorldBuilderConsole() {
  const [prompt, setPrompt] = useState("");
  const [buildResult, setBuildResult] = useState<BuildWorldResponse | null>(null);
  const [worldDetail, setWorldDetail] = useState<WorldDefinition | null>(null);
  const [worldJson, setWorldJson] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBuilding, startBuilding] = useTransition();
  const [isSaving, startSaving] = useTransition();
  async function loadWorldDetail(worldId: string) {
    const detailResponse = await fetch(`/api/worlds/${worldId}`, {
      cache: "no-store",
    });

    if (!detailResponse.ok) {
      const payload = (await detailResponse.json()) as { error?: string };
      throw new Error(payload.error ?? "Failed to load generated world detail.");
    }

    const payload = (await detailResponse.json()) as WorldDetailResponse;
    setWorldDetail(payload.world);
    setWorldJson(JSON.stringify(payload.world, null, 2));

    return payload;
  }

  function buildWorld() {
    setError(null);
    setStatus(null);

    startBuilding(async () => {
      const response = await fetch("/api/worlds/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const payload = (await response.json()) as BuildWorldResponse | { error?: string; message?: string };

      if (!response.ok) {
        const failureMessage =
          (payload as { message?: string }).message ??
          (payload as { error?: string }).error ??
          "Failed to build world.";
        setError(failureMessage);
        return;
      }

      const built = payload as BuildWorldResponse;
      setBuildResult(built);
      setStatus(`World published: ${built.world.title}`);

      try {
        const detail = await loadWorldDetail(built.worldId);
        const nextRoleId = detail.world.roles[0]?.id ?? built.roleId;
        setBuildResult({ ...built, roleId: nextRoleId });
      } catch (detailError) {
        setError(detailError instanceof Error ? detailError.message : "Failed to load editable world JSON.");
      }
    });
  }

  function saveWorldJson() {
    if (!buildResult) {
      return;
    }

    setError(null);
    setStatus(null);

    startSaving(async () => {
      let parsed: unknown;

      try {
        parsed = JSON.parse(worldJson);
      } catch {
        setError("World JSON is not valid JSON.");
        return;
      }

      const response = await fetch(`/api/worlds/${buildResult.worldId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: parsed }),
      });

      const payload = (await response.json()) as WorldDetailResponse | { error?: string };

      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "Failed to save world JSON.");
        return;
      }

      const updated = payload as WorldDetailResponse;
      setWorldDetail(updated.world);
      setWorldJson(JSON.stringify(updated.world, null, 2));
      const nextRoleId = updated.world.roles[0]?.id ?? buildResult.roleId;

      setBuildResult({
        ...buildResult,
        roleId: nextRoleId,
        world: {
          id: updated.world.id,
          title: updated.world.title,
          setting: updated.world.setting,
          premise: updated.world.premise,
          introNarration: updated.world.introNarration,
          roles: updated.world.roles,
        },
      });
      setStatus(`World saved (version ${updated.record?.version ?? "n/a"}).`);
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 lg:px-8">
      <section className="panel rounded-[2rem] p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--muted)]">World Builder</p>
        <h1 className="mt-4 text-3xl font-semibold text-stone-900 md:text-5xl">Generate a Dynamic Historical World</h1>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-stone-700 md:text-base">
          Describe the world you want to inhabit. The builder compiles a full world definition, auto-publishes it,
          and lets you edit JSON before launching a session.
        </p>

        <div className="mt-6 grid gap-4">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe your world intent..."
            className="min-h-32 rounded-[1.25rem] border border-[var(--border)] bg-white/75 px-4 py-4 text-sm leading-6 outline-none"
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={buildWorld}
              disabled={isBuilding || !prompt.trim()}
              className="rounded-full bg-[var(--accent-strong)] px-6 py-3 text-sm font-medium text-amber-50 transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBuilding ? "Building world..." : "Build World"}
            </button>

            <button
              type="button"
              onClick={saveWorldJson}
              disabled={!buildResult || !worldJson || isSaving}
              className="rounded-full border border-[var(--border)] bg-white/65 px-6 py-3 text-sm font-medium text-stone-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save JSON"}
            </button>
          </div>

          {status ? <p className="text-sm text-[var(--success)]">{status}</p> : null}
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="panel rounded-[2rem] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Generated World</p>
          {buildResult ? (
            <div className="mt-4 space-y-3 text-sm leading-7 text-stone-700">
              <p><span className="font-medium text-stone-900">Title:</span> {buildResult.world.title}</p>
              <p><span className="font-medium text-stone-900">Setting:</span> {buildResult.world.setting}</p>
              <p><span className="font-medium text-stone-900">Premise:</span> {buildResult.world.premise}</p>
              <p><span className="font-medium text-stone-900">World ID:</span> {buildResult.worldId}</p>
              <p><span className="font-medium text-stone-900">Start Role:</span> {buildResult.roleId}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-stone-500">Build a world to view summary metadata.</p>
          )}
        </aside>

        <section className="panel rounded-[2rem] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">World JSON Editor</p>
          <textarea
            value={worldJson}
            onChange={(event) => setWorldJson(event.target.value)}
            placeholder="Generated world JSON appears here after build."
            className="mt-4 min-h-[28rem] w-full rounded-[1.2rem] border border-[var(--border)] bg-white/80 px-4 py-4 font-mono text-xs leading-6 outline-none"
          />
        </section>
      </section>

      {worldDetail ? (
        <section className="panel rounded-[2rem] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">World Breakdown</p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <article className="rounded-[1.2rem] border border-[var(--border)] bg-white/65 p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Role</p>
              <div className="mt-3 space-y-2 text-sm text-stone-700">
                {worldDetail.roles.map((role) => (
                  <div key={role.id}>
                    <p className="font-medium text-stone-900">{role.title}</p>
                    <p>{role.summary}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[1.2rem] border border-[var(--border)] bg-white/65 p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Environment</p>
              <div className="mt-3 space-y-2 text-sm text-stone-700">
                <p><span className="font-medium text-stone-900">Setting:</span> {worldDetail.setting}</p>
                <p><span className="font-medium text-stone-900">Premise:</span> {worldDetail.premise}</p>
                <p><span className="font-medium text-stone-900">Intro Scene:</span> {worldDetail.introNarration}</p>
                <p>
                  <span className="font-medium text-stone-900">Narrator Voice:</span>{" "}
                  {worldDetail.narratorVoice
                    ? `${worldDetail.narratorVoice.label ?? "Narrator"} (${worldDetail.narratorVoice.provider})`
                    : "Not assigned"}
                </p>
              </div>
            </article>

            <article className="rounded-[1.2rem] border border-[var(--border)] bg-white/65 p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Cultural + Period Energy</p>
              <div className="mt-3 space-y-2 text-sm text-stone-700">
                <p className="font-medium text-stone-900">Norms</p>
                {worldDetail.norms.map((item) => (
                  <p key={`norm-${item}`}>• {item}</p>
                ))}
                <p className="pt-1 font-medium text-stone-900">Power Structures</p>
                {worldDetail.powerStructures.map((item) => (
                  <p key={`power-${item}`}>• {item}</p>
                ))}
              </div>
            </article>

            <article className="rounded-[1.2rem] border border-[var(--border)] bg-white/65 p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">People In Scene</p>
              <div className="mt-3 space-y-3 text-sm text-stone-700">
                {worldDetail.characters.map((character) => (
                  <div key={character.id}>
                    <p className="font-medium text-stone-900">{character.name} · {character.title}</p>
                    <p className="text-[var(--muted)]">{character.speakingStyle}</p>
                    <p className="text-[var(--muted)]">
                      Voice: {character.voice
                        ? `${character.voice.label ?? character.voice.voiceId} (${character.voice.provider})`
                        : "Not assigned"}
                    </p>
                    <p>Motivations: {character.motivations.join(", ")}</p>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <article className="mt-4 rounded-[1.2rem] border border-[var(--border)] bg-white/65 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Events In Play</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {worldDetail.eventTemplates.map((event) => (
                <div key={event.id} className="rounded-[1rem] border border-[var(--border)] bg-white/75 p-3">
                  <p className="font-medium text-stone-900">{event.title}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                    {event.category} · urgency {event.urgency}
                  </p>
                  <p className="mt-2 text-sm text-stone-700">{event.summary}</p>
                  <p className="mt-2 text-sm text-stone-700">
                    Scene prompt: {event.narratorPrompt}
                  </p>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
