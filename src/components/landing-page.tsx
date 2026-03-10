"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { VisibleWorld } from "@/types/simulation";

type SessionEnvelope = {
  session: {
    id: string;
  };
};

type ShowcaseWorld = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  atmosphere: string;
  accent: string;
  image: string;
  available: boolean;
  sourceWorld?: VisibleWorld;
};

const showcaseMeta: Array<
  Omit<ShowcaseWorld, "sourceWorld"> & {
    sourceWorldId?: string;
  }
> = [
  {
    id: "king-world",
    sourceWorldId: "the-king",
    title: "King World",
    eyebrow: "Imperial command simulation",
    description:
      "Rule a kingdom under pressure where mercy, brutality, debt, and legitimacy all reshape the fate of the realm. Every decree alters political stability, loyalty, and the stories people tell about your crown.",
    atmosphere: "Torchlight, rain on stone, restless nobles, and history tightening around every word.",
    accent: "from-amber-200/55 via-white/16 to-cyan-200/35",
    image: "/Kingworld.png",
    available: true,
  },
  {
    id: "pirate-world",
    title: "Pirate World",
    eyebrow: "High-seas survival simulation",
    description:
      "Command a ship through mutiny, storms, hunger, and plunder while loyalty shifts with every gamble. Survival depends on fear, charisma, and whether your crew believes your legend is worth following.",
    atmosphere: "Salt mist, lantern glass, muttered oaths, and the horizon hiding danger.",
    accent: "from-sky-200/50 via-white/14 to-teal-200/35",
    image: "/Pirateworld.png",
    available: false,
  },
  {
    id: "ceo-world",
    title: "CEO World",
    eyebrow: "Executive pressure simulation",
    description:
      "Lead a multi-billion-dollar company through layoffs, product failures, investor panic, and internal power struggles. Every decision tests your appetite for risk and the human cost of winning.",
    atmosphere: "Cold towers, live market signals, private briefings, and crises that never sleep.",
    accent: "from-blue-200/50 via-white/14 to-indigo-200/35",
    image: "/ceoworld.png",
    available: false,
  },
  {
    id: "war-general-world",
    title: "War General World",
    eyebrow: "Command-in-war simulation",
    description:
      "Carry the burden of strategy while soldiers, politicians, and civilians absorb the consequences. Tactical success is never clean, and each victory may hollow out what you hoped to protect.",
    atmosphere: "Command maps, radio static, smoke, and the quiet before irreversible orders.",
    accent: "from-stone-200/45 via-white/12 to-rose-200/35",
    image: "/Wargeneralworld.png",
    available: false,
  },
  {
    id: "explorer-world",
    title: "Viking World",
    eyebrow: "Discovery and survival simulation",
    description:
      "Lead an expedition into unknown terrain where wonder and catastrophe arrive together. Scarcity, weather, and fear inside the group can become as dangerous as anything outside it.",
    atmosphere: "Frozen dawns, wet journals, uncertain maps, and a frontier that does not care about you.",
    accent: "from-emerald-200/50 via-white/12 to-cyan-100/30",
    image: "/Vikingworld.png",
    available: false,
  },
];

function getWrappedOffset(index: number, activeIndex: number, total: number) {
  return ((index - activeIndex + total + 2) % total) - 2;
}

function getCarouselPose(offset: number) {
  if (offset === 0) {
    return { x: 0, y: -4, scale: 1, opacity: 1, blur: "0px", zIndex: 30 };
  }

  if (Math.abs(offset) === 1) {
    return {
      x: offset * 24,
      y: 12,
      scale: 0.8,
      opacity: 0.64,
      blur: "1.5px",
      zIndex: 20,
    };
  }

  return {
    x: offset * 33,
    y: 26,
    scale: 0.6,
    opacity: 0.28,
    blur: "4px",
    zIndex: 10,
  };
}

export function LandingPage({ worlds }: { worlds: VisibleWorld[] }) {
  const useWebmBackground = process.env.NEXT_PUBLIC_LANDING_HERO_USE_WEBM === "true";
  const heroVideoMp4 =
    process.env.NEXT_PUBLIC_LANDING_HERO_VIDEO_MP4 ??
    "/landing_page_video_optimized.mp4";
  const heroVideoWebm =
    process.env.NEXT_PUBLIC_LANDING_HERO_VIDEO_WEBM ??
    "/landing_page_video_optimized.webm";

  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [chatPrompt, setChatPrompt] = useState("");
  const [dragDelta, setDragDelta] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dragStartRef = useRef<number | null>(null);
  const dragLastRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const showcaseWorlds = showcaseMeta.map((item) => ({
    ...item,
    sourceWorld: item.sourceWorldId
      ? worlds.find((world) => world.id === item.sourceWorldId)
      : undefined,
  }));

  const activeWorld = showcaseWorlds[activeIndex] ?? showcaseWorlds[0];

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    void video.play().catch(() => undefined);
    let lastTime = -1;
    let stalledTicks = 0;

    const ensureLooping = window.setInterval(() => {
      if (!videoRef.current) {
        return;
      }

      const currentVideo = videoRef.current;
      const duration = Number.isFinite(currentVideo.duration) ? currentVideo.duration : 0;
      const nearEnd = duration > 0 && currentVideo.currentTime >= Math.max(duration - 0.12, 0);
      const timeAdvanced = Math.abs(currentVideo.currentTime - lastTime) > 0.01;

      if (timeAdvanced) {
        stalledTicks = 0;
      } else {
        stalledTicks += 1;
      }
      lastTime = currentVideo.currentTime;

      if (currentVideo.ended || nearEnd) {
        currentVideo.currentTime = 0;
        void currentVideo.play().catch(() => undefined);
        stalledTicks = 0;
        return;
      }

      if (stalledTicks >= 3) {
        // Some browsers stall the decoded frame without marking the element as ended.
        if (duration > 0 && currentVideo.currentTime > duration * 0.85) {
          currentVideo.currentTime = 0;
        }
        void currentVideo.play().catch(() => undefined);
        stalledTicks = 0;
        return;
      }

      if (currentVideo.paused) {
        void currentVideo.play().catch(() => undefined);
      }
    }, 1500);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && videoRef.current) {
        void videoRef.current.play().catch(() => undefined);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(ensureLooping);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (isDragging) {
      return;
    }

    const rotateTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      setActiveIndex((current) => (current + 1) % showcaseWorlds.length);
    }, 5000);

    return () => {
      window.clearInterval(rotateTimer);
    };
  }, [isDragging, showcaseWorlds.length]);

  function moveCarousel(direction: "next" | "previous") {
    setActiveIndex((current) =>
      direction === "next"
        ? (current + 1) % showcaseWorlds.length
        : (current - 1 + showcaseWorlds.length) % showcaseWorlds.length,
    );
    setError(null);
  }

  function getDragProgress(delta: number) {
    return Math.max(-18, Math.min(18, delta / 14));
  }

  function handlePointerStart(clientX: number) {
    dragStartRef.current = clientX;
    dragLastRef.current = clientX;
    setDragDelta(0);
    setIsDragging(true);
  }

  function handlePointerMove(clientX: number) {
    if (dragStartRef.current === null) {
      return;
    }

    dragLastRef.current = clientX;
    setDragDelta(clientX - dragStartRef.current);
  }

  function handlePointerEnd(clientX?: number) {
    const origin = dragStartRef.current;

    if (origin === null) {
      return;
    }

    const resolved = clientX ?? dragLastRef.current ?? origin;
    const delta = resolved - origin;
    const threshold = 36;

    if (delta <= -threshold) {
      moveCarousel("next");
    } else if (delta >= threshold) {
      moveCarousel("previous");
    }

    dragStartRef.current = null;
    dragLastRef.current = null;
    setDragDelta(0);
    setIsDragging(false);
  }

  async function beginSession() {
    const playableWorld = activeWorld.sourceWorld;

    if (!activeWorld.available || !playableWorld) {
      setError(
        `${activeWorld.title} is staged for the slider, but its simulation pack is not implemented yet.`,
      );
      return;
    }

    const role = playableWorld.roles[0];

    if (!role) {
      setError("Selected world has no playable role.");
      return;
    }

    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldId: playableWorld.id, roleId: role.id }),
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

  const dragProgress = getDragProgress(dragDelta);

  return (
    <main className="min-h-screen bg-[#eadfc9] text-white">
      <section className="relative min-h-screen overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            WebkitMaskImage:
              "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 72%, rgba(0,0,0,0) 100%)",
            maskImage:
              "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 72%, rgba(0,0,0,0) 100%)",
          }}
          aria-hidden="true"
          onEnded={() => {
            const video = videoRef.current;
            if (!video) return;
            video.currentTime = 0;
            void video.play().catch(() => undefined);
          }}
          onCanPlay={() => {
            const video = videoRef.current;
            if (!video || !video.paused) return;
            void video.play().catch(() => undefined);
          }}
        >
          <source src={heroVideoMp4} type="video/mp4" />
          {useWebmBackground ? <source src={heroVideoWebm} type="video/webm" /> : null}
        </video>
        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-8 pt-10 text-center md:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-4xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.38em] text-white/72">
              Pandora&apos;s Box
            </p>

            <div className="mx-auto flex max-w-4xl items-center justify-center gap-3 rounded-full border border-white/12 bg-white/6 px-3 py-2 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-cyan-200 shadow-[0_0_18px_rgba(157,244,235,0.9)]" />
              <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-white/72 md:text-[11px]">
                Select a reality
              </p>
            </div>
          </div>

          <form
            className="mx-auto mt-auto mb-8 w-full max-w-2xl md:mb-10"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <p className="mb-3 text-center text-lg font-medium tracking-[0.03em] text-white/86 md:text-2xl">
              Simulate your desired experience
            </p>
            <div className="relative rounded-[20px] border border-white/20 bg-white/8 p-2 shadow-[0_12px_44px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
              <input
                value={chatPrompt}
                onChange={(event) => setChatPrompt(event.target.value)}
                placeholder="Chat with the world selector..."
                className="w-full rounded-[14px] border border-transparent bg-transparent px-4 py-4 pr-14 text-sm text-white placeholder:text-white/55 outline-none md:text-base"
              />
              <button
                type="submit"
                aria-label="Send message"
                className="absolute right-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[12px] border border-white/24 bg-white/10 text-white transition hover:bg-white/18"
              >
                <span className="text-base leading-none">↗</span>
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="relative bg-[#eadfc9] text-[#1f2a30]">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 text-center md:px-6 md:py-16 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="flex items-center justify-center gap-3">
              <div
                ref={containerRef}
                className={`relative h-[18rem] w-full max-w-6xl touch-pan-y overflow-hidden md:h-[22rem] ${
                  isDragging ? "cursor-grabbing" : "cursor-grab"
                }`}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  handlePointerStart(event.clientX);
                }}
                onPointerMove={(event) => handlePointerMove(event.clientX)}
                onPointerUp={(event) => handlePointerEnd(event.clientX)}
                onPointerCancel={() => handlePointerEnd()}
              >
                {showcaseWorlds.map((world, index) => {
                  const offset = getWrappedOffset(index, activeIndex, showcaseWorlds.length);
                  const pose = getCarouselPose(offset);
                  const isActive = offset === 0;

                  return (
                    <button
                      key={world.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        if (isDragging) {
                          return;
                        }
                        setActiveIndex(index);
                        setError(null);
                      }}
                      className="absolute left-1/2 top-1/2 flex aspect-square w-28 items-center justify-center rounded-full md:w-40"
                      style={{
                        left: `calc(50% + ${pose.x + dragProgress}%)`,
                        top: `calc(50% + ${pose.y}%)`,
                        transform: `translate(-50%, -50%) scale(${pose.scale})`,
                        opacity: pose.opacity,
                        filter: `blur(${pose.blur})`,
                        zIndex: pose.zIndex,
                        boxShadow: isActive
                          ? "0 14px 40px rgba(36, 48, 52, 0.35)"
                          : "0 8px 24px rgba(38, 49, 54, 0.22)",
                        transition: isDragging
                          ? "opacity 220ms ease, filter 220ms ease, box-shadow 220ms ease"
                          : "left 520ms ease, top 520ms ease, transform 520ms ease, opacity 420ms ease, filter 420ms ease, box-shadow 420ms ease",
                      }}
                    >
                      <span className="absolute inset-0 overflow-hidden rounded-full">
                        <Image
                          src={world.image}
                          alt={world.title}
                          fill
                          sizes="160px"
                          className="object-cover"
                        />
                      </span>
                      <span className="absolute -bottom-9 z-10 rounded-full bg-white/86 px-2 py-1 text-center font-mono text-[10px] uppercase tracking-[0.24em] text-[#1d2830] md:text-xs">
                        {world.title.replace(" World", "")}
                      </span>
                      {!world.available ? (
                        <span className="absolute -bottom-16 rounded-full border border-white/40 bg-white/72 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.24em] text-[#465059] md:text-[9px]">
                          Incoming
                        </span>
                      ) : null}
                    </button>
                  );
                })}

                <div className="pointer-events-none absolute inset-x-[18%] bottom-7 h-10 rounded-full bg-white/8 blur-3xl md:inset-x-[30%]" />
              </div>
            </div>
          </div>

          <div className="mx-auto mt-6 max-w-4xl rounded-[2rem] border border-[#bfa882]/55 bg-white/46 px-5 py-6 shadow-[0_18px_52px_rgba(43,48,45,0.18)] backdrop-blur-2xl md:grid md:grid-cols-[0.88fr_1.12fr] md:items-center md:gap-8 md:px-8">
            <div className="relative mx-auto h-48 w-full max-w-sm overflow-hidden rounded-[1.7rem] border border-white/35 bg-black/12 shadow-[0_18px_54px_rgba(0,0,0,0.18)]">
              <Image
                src={activeWorld.image}
                alt={activeWorld.title}
                fill
                sizes="(max-width: 768px) 100vw, 420px"
                className="object-cover"
              />
              <div className={`absolute inset-0 bg-gradient-to-br ${activeWorld.accent} opacity-35`} />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.06),rgba(0,0,0,0.48))]" />
            </div>

            <div className="mt-5 md:mt-0 md:text-left">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#6b5f4e]">
                {activeWorld.eyebrow}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-[#20272c] md:text-5xl">
                {activeWorld.title}
              </h2>
              <p className="mt-4 text-sm leading-7 text-[#2e3438] md:text-base">
                {activeWorld.description}
              </p>
              <p className="mt-3 text-sm italic tracking-[-0.01em] text-[#5a5f63]">
                {activeWorld.atmosphere}
              </p>
            </div>
          </div>

          <div className="mx-auto mt-6 flex max-w-4xl flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void beginSession()}
              disabled={isPending}
              className="inline-flex min-w-[16rem] items-center justify-center gap-3 rounded-[1.2rem] border border-[#30434f]/35 bg-[#2f4653]/92 px-8 py-4 text-base font-medium text-[#f5eddc] shadow-[0_12px_32px_rgba(34,47,53,0.22)] transition hover:bg-[#243a46] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending
                ? "Opening reality..."
                : activeWorld.available
                  ? `Enter ${activeWorld.title}`
                  : `Focus ${activeWorld.title}`}
              <span aria-hidden="true">→</span>
            </button>

            <div className="rounded-[1.2rem] border border-[#bfa882]/55 bg-white/46 px-5 py-4 text-left backdrop-blur-xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#6c624f]">
                Current status
              </p>
              <p className="mt-2 text-sm text-[#2e3438]">
                {activeWorld.available
                  ? "Playable now with session routing and world-state simulation."
                  : "Featured in the selector now. Simulation pack arrives in a later release."}
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center">
            <Link
              href="/builder"
              className="inline-flex items-center gap-2 rounded-full border border-white/22 bg-white/10 px-4 py-2 text-sm text-white/90 backdrop-blur-xl transition hover:bg-white/18"
            >
              Build a New World
              <span aria-hidden="true">↗</span>
            </Link>
          </div>

          <p className="mt-8 text-lg italic tracking-[-0.01em] text-white/56">
            &ldquo;What is it like to become someone else and have the world answer honestly?&rdquo;
          </p>
          {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
