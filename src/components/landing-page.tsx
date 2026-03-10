"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { VisibleWorld } from "@/types/simulation";

type SessionEnvelope = {
  session: {
    id: string;
  };
};

export function LandingPage({ worlds }: { worlds: VisibleWorld[] }) {
  const heroVideoMp4 =
    process.env.NEXT_PUBLIC_LANDING_HERO_VIDEO_MP4 ??
    "/landing_page_video_optimized.mp4";
  const heroVideoWebm =
    process.env.NEXT_PUBLIC_LANDING_HERO_VIDEO_WEBM ??
    "/landing_page_video_optimized.webm";

  const router = useRouter();
  const [selectedWorld, setSelectedWorld] = useState<VisibleWorld | null>(worlds[0] ?? null);
  const [worldPrompt, setWorldPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const promptMatchedWorld = useMemo(() => {
    const normalized = worldPrompt.trim().toLowerCase();

    if (!normalized) {
      return null;
    }

    return (
      worlds.find((world) => {
        return [world.title, world.setting, world.premise]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      }) ?? null
    );
  }, [worldPrompt, worlds]);

  const activeWorld = promptMatchedWorld ?? selectedWorld;

  async function beginSession() {
    if (!activeWorld) {
      setError("No world is available. Add a world pack before starting.");
      return;
    }

    const role = activeWorld.roles[0];

    if (!role) {
      setError("Selected world has no playable role.");
      return;
    }

    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldId: activeWorld.id, roleId: role.id }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Failed to start session.");
        return;
      }

      const payload = (await response.json()) as SessionEnvelope;
      router.push(`/simulation/${payload.session.id}`);
    });
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
        aria-hidden="true"
      >
        <source src={heroVideoWebm} type="video/webm" />
        <source src={heroVideoMp4} type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.2),rgba(0,0,0,0)_45%,rgba(0,0,0,0.42))]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_70%,rgba(255,244,210,0.22),transparent_45%)]" />

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-4 py-12 text-center md:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-white/80">Pandora&apos;s Box</p>

        <h1 className="mt-6 max-w-4xl text-4xl leading-tight font-semibold text-white drop-shadow-[0_6px_24px_rgba(0,0,0,0.35)] md:text-6xl">
          Step into a world that answers back.
        </h1>

        <p className="mt-4 max-w-2xl text-sm leading-7 text-white/80 md:text-base">
          Describe your intent, choose a realm, and begin a session where every decision changes political pressure,
          sentiment, and fate.
        </p>

        <form
          className="mt-10 w-full max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault();
            void beginSession();
          }}
        >
          <div className="relative rounded-[24px] border border-white/25 bg-white/10 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <input
              value={worldPrompt}
              onChange={(event) => setWorldPrompt(event.target.value)}
              placeholder="Describe your world..."
              className="w-full rounded-[18px] border border-transparent bg-transparent px-5 py-4 pr-16 text-base text-white placeholder:text-white/55 outline-none"
            />
            <button
              type="submit"
              aria-label="Begin journey"
              className="absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[14px] border border-white/30 bg-white/10 text-white transition hover:bg-white/20"
            >
              <span className="text-lg leading-none">↗</span>
            </button>
          </div>
        </form>

        <button
          type="button"
          onClick={() => void beginSession()}
          disabled={!activeWorld || isPending}
          className="mt-9 inline-flex items-center gap-3 rounded-[16px] border border-white/30 bg-white/12 px-10 py-4 text-lg font-medium tracking-[-0.01em] text-white shadow-[0_12px_40px_rgba(0,0,0,0.2)] backdrop-blur-xl transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Creating session..." : "Begin Your Journey"}
          <span aria-hidden="true">→</span>
        </button>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {worlds.map((world) => (
            <button
              key={world.id}
              type="button"
              onClick={() => setSelectedWorld(world)}
              className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.2em] backdrop-blur-xl transition md:text-sm ${
                activeWorld?.id === world.id
                  ? "border-white/55 bg-white/24 text-white"
                  : "border-white/30 bg-white/10 text-white/80 hover:bg-white/18"
              }`}
            >
              {world.title}
            </button>
          ))}
        </div>

        <p className="mt-4 text-sm text-white/80 md:text-base">
          Active world: <span className="font-medium text-white">{activeWorld?.title ?? "None"}</span>
        </p>

        <p className="mt-16 text-lg italic tracking-[-0.01em] text-white/60">
          &ldquo;What is it like to be someone else entirely?&rdquo;
        </p>

        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
      </section>
    </main>
  );
}
