"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { GoogleAuthButton } from "./google-auth-button";
import { MeshGradient } from "./mesh-gradient";

const HERO_TIERS = [
  { src: "/landing-hero-placeholder.jpg", minWidth: 0 },
  { src: "/landing-hero-sm.jpg", minWidth: 0 },
  { src: "/landing-hero-md.jpg", minWidth: 0 },
  { src: "/landing-hero-lg.jpg", minWidth: 1280 },
  { src: "/landing-hero.jpg", minWidth: 2560 },
] as const;

function useProgressiveHero() {
  const [tierIndex, setTierIndex] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const vw = window.innerWidth * (window.devicePixelRatio ?? 1);
    let targetTier = HERO_TIERS.length - 1;
    for (let i = HERO_TIERS.length - 1; i > 0; i--) {
      if (vw < HERO_TIERS[i].minWidth) {
        targetTier = i - 1;
      }
    }

    let cancelled = false;
    const img = new window.Image();
    img.src = HERO_TIERS[targetTier].src;
    img.onload = () => {
      if (cancelled) return;
      setTierIndex(targetTier);
    };

    const kickoff = requestAnimationFrame(() => setReady(true));

    return () => {
      cancelled = true;
      cancelAnimationFrame(kickoff);
    };
  }, []);

  return { src: HERO_TIERS[tierIndex].src, ready, isPlaceholder: tierIndex === 0 };
}

const heading = "var(--font-heading)";
const mono = "var(--font-mono)";

const EXPERIENCE_CATEGORIES = [
  {
    label: "Education",
    body: "The best way to learn is Socratically. Study for a test or step into history through conversation — like an audio time machine.",
    tags: ["Einstein", "Shakespeare", "George Washington"],
  },
  {
    label: "Creation",
    body: "Turn your ideas and source material into original characters, stories, and responsive worlds.",
    tags: ["Original personalities", "Living casts", "Custom worlds"],
  },
  {
    label: "Entertainment",
    body: "Enter fantasy adventures and mysteries that remember your choices and change around you.",
    tags: ["Fantasy quests", "Mysteries & roleplay", "Play with friends"],
  },
];

const FEATURES = [
  {
    title: "Living AI Characters",
    body: "Speak naturally and they answer in kind. Characters remember what happened, relationships evolve, and an entire cast can share the same scene.",
    context: "Entertainment",
  },
  {
    title: "Historically Accurate Characters",
    body: "Bring any historical character back to life — from Einstein and Shakespeare to George Washington. Speak with them, question their ideas, and learn like never before.",
    context: "Education",
  },
  {
    title: "Transparent Sources",
    body: "Historical characters are grounded in curated source material. Each character’s Sources page shows where their knowledge comes from, so exploration stays credible.",
    context: "Education",
  },
  {
    title: "Create Your Own Characters",
    body: "Turn notes, documents, and research into a living personality with a voice, memory, worldview, and relationships of its own.",
    context: "Creation",
  },
  {
    title: "Build Your Own Worlds",
    body: "Build a fantasy kingdom, a mystery, a pirate ship, or a universe entirely your own. Every choice can move the story somewhere new — the possibilities are endless.",
    context: "Creation · Entertainment",
  },
];

const KAWABUNGA_PRINCIPLES = [
  {
    title: "Speak naturally",
    body: "The world listens, understands, and answers in real time.",
  },
  {
    title: "Shape what happens",
    body: "Every choice can redirect relationships, scenes, and stories.",
  },
  {
    title: "Return to something living",
    body: "Characters remember the conversation, so the experience carries its own continuity.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Relevant Context",
    body: "The knowledge graph finds the people, events, places, and ideas that matter for this exact moment, giving every response focused understanding.",
  },
  {
    title: "Scene Direction",
    body: "The orchestrator chooses who speaks, advances the story, and cues narration, ambience, and sound — keeping the experience coherent and alive.",
  },
];

const TECHNOLOGY_SLIDES = [
  {
    title: "Knowledge Graph Architecture",
    body: "Thousands of facts become connected people, events, places, and ideas. The right context surfaces for each question instead of loading an entire library at once.",
  },
  {
    title: "Source Ingestion Pipeline",
    body: "Documents, books, and research are mapped into structured pages, relationships, timelines, and source-backed passages a character can actually use.",
  },
  {
    title: "Provenance & Citations",
    body: "Knowledge keeps its connection to the original passage and citation, so important claims can be inspected instead of taken on faith.",
  },
  {
    title: "Real-Time Orchestration",
    body: "A real-time director selects the next speaker, gives the scene its next beat, and coordinates narration, ambience, and sound effects.",
  },
  {
    title: "Adaptive Environmental Audio",
    body: "Ambient sound changes with the setting while precisely timed effects land with the action, letting every room and world feel present.",
  },
  {
    title: "Audio Wave Field",
    body: "Voice and atmosphere become a living visual field that moves with every word, giving the scene a pulse you can see as well as hear.",
  },
];

type RevealVariant = "up" | "left" | "right" | "scale" | "fade";

function Reveal({
  children,
  className = "",
  delay = 0,
  variant = "up",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: RevealVariant;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.unobserve(entry.target);
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`motion-reveal ${className}`}
      data-reveal-state={visible ? "visible" : "hidden"}
      data-reveal-variant={variant}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function ParallaxLayer({
  children,
  className = "",
  speed = 0.06,
  maxOffset = 48,
}: {
  children: ReactNode;
  className?: string;
  speed?: number;
  maxOffset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const viewportCenter = window.innerHeight / 2;
      const elementCenter = rect.top + rect.height / 2;
      const offset = Math.max(-maxOffset, Math.min(maxOffset, (viewportCenter - elementCenter) * speed));
      element.style.setProperty("--parallax-y", `${offset.toFixed(2)}px`);
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, [maxOffset, speed]);

  return (
    <div ref={ref} className={`motion-parallax ${className}`}>
      {children}
    </div>
  );
}

function ImageCarousel({
  slides,
  initialIndex = 0,
}: {
  slides: Array<{ title: string; body: string }>;
  initialIndex?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(initialIndex);

  const scrollToSlide = (index: number) => {
    const card = trackRef.current?.children[index] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  // Start centered on `initialIndex` so its neighbors peek on load, rather
  // than always opening on the first card. A direct `scrollLeft` write
  // keeps this instant, with no scroll animation on first paint.
  useEffect(() => {
    const track = trackRef.current;
    const card = track?.children[initialIndex] as HTMLElement | undefined;
    if (!track || !card) return;
    const cardRect = card.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    track.scrollLeft += cardRect.left - trackRect.left + cardRect.width / 2 - track.clientWidth / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const viewportCenter = track.getBoundingClientRect().left + track.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Infinity;
    Array.from(track.children).forEach((child, idx) => {
      const rect = (child as HTMLElement).getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = idx;
      }
    });
    setActive(closestIndex);
  };

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto px-[6%] sm:gap-6 sm:px-[13%] lg:px-[20%]"
      >
        {slides.map((slide, i) => (
          <div
            key={slide.title}
            className="relative flex aspect-square w-full flex-shrink-0 snap-center overflow-hidden rounded-2xl border border-white/6 bg-white/[0.04] sm:aspect-[16/10]"
          >
            {/* Image placeholder — becomes the card's background once real art is dropped in. */}
            <div className="cinematic-surface absolute inset-0 flex items-center justify-center bg-white/[0.02]">
              <span
                className="text-[10px] uppercase tracking-[0.2em] text-white/15"
                style={{ fontFamily: mono }}
              >
                Image
              </span>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />

            <span
              className="absolute left-5 top-5 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.15em] text-white/70 backdrop-blur-sm"
              style={{ fontFamily: mono }}
            >
              {String(i + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
            </span>

            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
              <h3 className="text-2xl font-semibold sm:text-3xl" style={{ fontFamily: heading }}>
                {slide.title}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-white/70 sm:text-base">
                {slide.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-center gap-2">
        {slides.map((slide, i) => (
          <button
            key={slide.title}
            type="button"
            onClick={() => scrollToSlide(i)}
            aria-label={`Go to ${slide.title}`}
            className={`h-1.5 rounded-full transition-all ${
              i === active ? "w-6 bg-[#8fd1cb]" : "w-1.5 bg-white/20 hover:bg-white/35"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function ExperienceConnector() {
  return (
    <div className="flex h-10 items-center justify-center lg:h-auto lg:w-10" aria-hidden="true">
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        className="rotate-90 text-[#8fd1cb]/45 lg:rotate-0"
      >
        <line x1="3" y1="20" x2="34" y2="20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 5" />
        <path d="M29 14l7 6-7 6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/**
 * A hybrid of the two reference layouts: three connected square cards set up
 * the kinds of worlds Kawabunga can become, then alternating editorial rows
 * create a zigzag down the page. The empty surfaces are intentionally blank so
 * art, product UI, motion, or video can be added later without redesigning the
 * content structure.
 */
function ExperienceCanvas({
  categories,
  features,
}: {
  categories: Array<{ label: string; body: string; tags: string[] }>;
  features: Array<{ title: string; body: string; context: string }>;
}) {
  return (
    <div className="px-6 sm:px-10 lg:px-20">
      <Reveal>
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <p
            className="text-[11px] uppercase tracking-[0.2em] text-[#8fd1cb]"
            style={{ fontFamily: mono }}
          >
            Choose the kind of world
          </p>
          <p className="max-w-sm text-sm leading-relaxed text-white/35 sm:text-right">
            Learn inside it. Create it from scratch. Or enter it purely for the experience.
          </p>
        </div>
      </Reveal>

      <div className="grid items-center lg:grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)]">
        {categories.map((category, i) => (
          <Fragment key={category.label}>
            <Reveal delay={i * 110} variant="scale" className="h-full">
              <article className="flex min-h-[380px] flex-col overflow-hidden rounded-3xl border border-white/8 bg-white/[0.035] lg:aspect-square lg:min-h-0">
                <div className="cinematic-surface min-h-24 flex-1 bg-white/[0.012]" aria-hidden="true" />
                <div className="border-t border-white/8 p-5 sm:p-6">
                  <span
                    className="text-[10px] uppercase tracking-[0.2em] text-white/30"
                    style={{ fontFamily: mono }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3
                    className="mt-2 text-xl font-semibold text-[#8fd1cb] sm:text-2xl"
                    style={{ fontFamily: heading }}
                  >
                    {category.label}
                  </h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-white/50 sm:text-sm">{category.body}</p>
                  <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
                    {category.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] uppercase tracking-[0.09em] text-white/28"
                        style={{ fontFamily: mono }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            </Reveal>
            {i < categories.length - 1 && (
              <Reveal delay={i * 110 + 140} variant="fade">
                <ExperienceConnector />
              </Reveal>
            )}
          </Fragment>
        ))}
      </div>

      <div className="mt-24 border-t border-white/8 pt-10 sm:mt-32 sm:pt-12">
        <Reveal>
          <div className="mb-14 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h3 className="text-2xl font-semibold sm:text-3xl" style={{ fontFamily: heading }}>
              What makes it feel alive
            </h3>
            <p className="max-w-sm text-sm leading-relaxed text-white/35 sm:text-right">
              Five connected capabilities, each with room to become its own visual story.
            </p>
          </div>
        </Reveal>

        <div className="space-y-20 sm:space-y-28 lg:space-y-32">
          {features.map((feature, i) => {
            const canvasOnRight = i % 2 === 0;

            return (
              <article key={feature.title} className="grid items-center gap-8 lg:grid-cols-12 lg:gap-0">
                <Reveal
                  className={`lg:row-start-1 lg:col-span-4 ${
                    canvasOnRight ? "lg:col-start-1" : "lg:col-start-9"
                  }`}
                  variant={canvasOnRight ? "left" : "right"}
                >
                  <div>
                    <p
                      className="text-[10px] uppercase tracking-[0.2em] text-[#8fd1cb]"
                      style={{ fontFamily: mono }}
                    >
                      {String(i + 1).padStart(2, "0")} — {feature.context}
                    </p>
                    <h4
                      className="mt-4 max-w-md text-2xl font-semibold leading-tight sm:text-3xl"
                      style={{ fontFamily: heading, letterSpacing: "-0.025em" }}
                    >
                      {feature.title}
                    </h4>
                    <p className="mt-4 max-w-md text-sm leading-relaxed text-white/48 sm:text-base sm:leading-7">
                      {feature.body}
                    </p>
                  </div>
                </Reveal>

                <Reveal
                  delay={100}
                  variant="scale"
                  className={`aspect-[16/10] rounded-3xl border border-white/8 bg-white/[0.025] lg:row-start-1 lg:col-span-7 ${
                    canvasOnRight ? "lg:col-start-6" : "lg:col-start-1"
                  }`}
                >
                  <div className="cinematic-surface h-full w-full rounded-3xl" aria-hidden="true" />
                </Reveal>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AudioWaveBars() {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const BAR_COUNT = 7;
  const BASE_HEIGHTS = [12, 20, 8, 24, 14, 18, 10];
  const BASE_OPACITIES = [0.5, 0.7, 0.4, 1, 0.6, 0.8, 0.45];

  useEffect(() => {
    let frame: number;
    const animate = () => {
      const t = performance.now() / 1000;
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const phase = i * 0.9;
        const wave = Math.sin(t * 2.5 + phase) * 0.4 + 0.6;
        const h = BASE_HEIGHTS[i] * wave;
        const o = BASE_OPACITIES[i] * (0.5 + wave * 0.5);
        bar.style.height = `${h}px`;
        bar.style.opacity = `${o}`;
      });
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex items-end gap-[3px]" style={{ height: 24 }}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          className="w-[3px] rounded-full bg-[#8fd1cb]"
          style={{
            height: BASE_HEIGHTS[i],
            opacity: BASE_OPACITIES[i],
            transition: "height 0.15s ease, opacity 0.15s ease",
          }}
        />
      ))}
    </div>
  );
}

export function LandingPageV3() {
  const hero = useProgressiveHero();

  useEffect(() => {
    document.documentElement.classList.add("motion-ready");
    return () => document.documentElement.classList.remove("motion-ready");
  }, []);

  return (
    <main className="w-full bg-[#0a0a0a] text-white" style={{ fontFamily: "var(--font-body)" }}>
      {/* ── Hero ── */}
      <section className="relative h-screen w-full overflow-hidden">
        <ParallaxLayer className="absolute -inset-y-16 inset-x-0 scale-[1.04]" speed={0.075} maxOffset={52}>
          <Image
            src={hero.src}
            alt="Immersive digital forest — streams of light and data flowing through ancient trees"
            fill
            className={`object-cover transition-[filter] duration-700 ${hero.isPlaceholder ? "blur-xl scale-105" : ""}`}
            priority
            quality={90}
            sizes="100vw"
          />
        </ParallaxLayer>
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-black/20 to-black/40" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent" />

        <div className="relative z-10 flex h-full flex-col">
          <Reveal variant="fade">
            <header className="flex items-center justify-between px-6 py-5 sm:px-10 lg:px-20">
              <Link href="/" className="flex items-center gap-2">
                <svg width="42" height="20" viewBox="0 0 846 412" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M95.3349 32.3641C140.828 3.25796 195.953 -6.74816 248.769 4.51353C312.506 18.4369 362.941 64.7739 397.235 118.473C410.998 140.106 422.66 163.002 432.08 186.848C421.115 170.658 410.555 155.156 397.782 140.268C361.529 98.0309 311.248 62.4632 255.858 51.8407C210.161 42.6698 162.694 52.098 123.967 78.037C89.616 101.278 65.8722 137.189 57.9364 177.904C50.5371 217.4 60.869 257.572 83.3974 290.488C110.917 330.697 154.914 357.222 202.501 366.101C407.637 404.376 607.843 107.979 769.333 158.584C793.265 166.084 813.762 180.166 828.095 200.908C843.455 223.529 849.163 251.339 843.973 278.183C830.533 351.268 750.98 393.03 681.973 378.139C673.993 376.417 666.987 374.613 659.18 372.195C651.147 369.298 644.255 366.779 636.477 363.311C643.351 364.372 653.293 368.279 661.545 370.065L662.338 370.231L664.285 370.659C705.105 379.466 740.631 377.231 777.088 355C849.38 310.926 853.407 203.84 759.095 182.902C693.35 168.305 627.252 214.01 573.867 246.973C454.512 322.209 319.778 436.396 168.664 407.001C113.639 396.297 64.2686 362.463 33.0341 316.001C-29.8667 222.432 0.428465 93.4192 95.3349 32.3641Z" fill="#8fd1cb"/>
                </svg>
                <span className="text-xl font-bold tracking-tight" style={{ fontFamily: heading }}>
                  Kawabunga
                </span>
              </Link>

              <div className="flex items-center gap-2">
                <GoogleAuthButton />
              </div>
            </header>
          </Reveal>

          <div className="flex flex-1 flex-col justify-end px-6 pb-12 sm:px-10 lg:px-20 lg:pb-16">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <Reveal delay={120}>
                <div className="max-w-xl space-y-6">
                  <h1
                    className="text-4xl font-semibold leading-[1.1] sm:text-5xl lg:text-[64px]"
                    style={{ fontFamily: heading, letterSpacing: "-0.04em" }}
                  >
                    <span className="text-[#8fd1cb]">Step into any world</span>
                    <br />
                    you can imagine
                  </h1>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <Link
                      href="/about"
                      className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-6 py-2.5 text-sm backdrop-blur-lg transition-all hover:scale-[1.03] hover:border-white/40 hover:bg-white/25"
                      style={{ fontFamily: mono }}
                    >
                      Explore Worlds
                      <span className="text-white/60">&rarr;</span>
                    </Link>
                    <Link
                      href="/about"
                      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-6 py-2.5 text-sm backdrop-blur-md transition-all hover:scale-[1.03] hover:border-white/30 hover:bg-white/15"
                      style={{ fontFamily: mono }}
                    >
                      Learn More
                      <span className="text-white/60">&rarr;</span>
                    </Link>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={260}>
                <div className="flex flex-col items-start gap-4">
                  <AudioWaveBars />
                  <p
                    className="max-w-md text-sm leading-relaxed text-white/60 lg:text-[15px] lg:leading-6"
                    style={{ fontFamily: mono }}
                  >
                    A voice-first immersive reality engine where you inhabit
                    characters, shape narratives, and experience worlds that respond
                    to every choice you make.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── What is Kawabunga ── */}
      <section id="what-is-kawabunga" className="px-6 py-24 sm:px-10 sm:py-28 lg:px-20 lg:py-32">
        <div className="grid gap-14 lg:grid-cols-12 lg:items-start lg:gap-8">
          <Reveal className="lg:col-span-5">
            <div>
              <p
                className="text-[10px] uppercase tracking-[0.2em] text-[#8fd1cb]"
                style={{ fontFamily: mono }}
              >
                A new kind of medium
              </p>
              <h2
                className="mt-4 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl lg:leading-tight"
                style={{ fontFamily: heading, letterSpacing: "-0.03em" }}
              >
                What is Kawabunga
              </h2>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-white/80 sm:text-xl">
                Not a chatbot. <span className="text-[#8fd1cb]">A world that becomes whatever you need it to be.</span>
              </p>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/45 lg:text-base lg:leading-7">
                Living audio worlds where voices, characters, and stories respond to you in real time.
              </p>
            </div>
          </Reveal>

          <div className="border-y border-white/8 lg:col-span-6 lg:col-start-7">
            {KAWABUNGA_PRINCIPLES.map((principle, i) => (
              <Reveal
                key={principle.title}
                delay={i * 100}
                variant="right"
                className="border-b border-white/8 last:border-b-0"
              >
                <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-4 py-6 sm:grid-cols-[40px_minmax(0,1fr)] sm:gap-6 sm:py-7">
                  <span
                    className="pt-1 text-[10px] tracking-[0.18em] text-white/25"
                    style={{ fontFamily: mono }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-xl font-semibold sm:text-2xl" style={{ fontFamily: heading }}>
                      {principle.title}
                    </h3>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-white/45 sm:text-base">
                      {principle.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="pb-24 pt-12 sm:pb-32 sm:pt-16 lg:pb-36">
        <div className="px-6 sm:px-10 lg:px-20">
          <Reveal>
            <h2
              className="max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl lg:leading-tight"
              style={{ fontFamily: heading, letterSpacing: "-0.03em" }}
            >
              The Kawabunga Experience
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#8fd1cb] lg:text-base lg:leading-7">
              Everything that makes a world feel alive.
            </p>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/50 lg:text-base lg:leading-7">
              Browse what&rsquo;s possible.
            </p>
          </Reveal>
        </div>

        <div className="mt-16 sm:mt-20">
          <ExperienceCanvas categories={EXPERIENCE_CATEGORIES} features={FEATURES} />
        </div>
      </section>

      {/* ── How It Works · Technology ── */}
      <section id="how-it-works" className="px-6 py-24 sm:px-10 sm:py-32 lg:px-20 lg:py-36">
        <Reveal>
          <h2
            className="max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl lg:leading-tight"
            style={{ fontFamily: heading, letterSpacing: "-0.03em" }}
          >
            How It Works
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#8fd1cb] lg:text-base lg:leading-7">
            Three systems, working together in real time.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45 lg:text-base lg:leading-7">
            Source material becomes a character&rsquo;s mind. Relevant knowledge surfaces for each turn, and an invisible director turns it into a responsive scene.
          </p>
        </Reveal>

        {/* Character Brain — the signature graphic, given the most room. */}
        <Reveal className="mt-14" variant="scale">
          <div className="relative flex aspect-square w-full overflow-hidden rounded-2xl border border-white/6 bg-white/[0.04] sm:aspect-[21/9]">
            <div className="cinematic-surface absolute inset-0 flex items-center justify-center bg-white/[0.02]">
              <span
                className="text-[10px] uppercase tracking-[0.2em] text-white/15"
                style={{ fontFamily: mono }}
              >
                Diagram
              </span>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
              <h3 className="text-2xl font-semibold sm:text-3xl" style={{ fontFamily: heading }}>
                Character Brain
              </h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-white/70 sm:text-base">
                Sources become structured knowledge, and structured knowledge becomes a character with a distinct identity, perspective, and understanding of its world.
              </p>
            </div>
          </div>
        </Reveal>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:gap-6">
          {HOW_IT_WORKS.map((item, i) => (
            <Reveal key={item.title} delay={i * 120} variant="scale">
              <div className="relative flex aspect-square w-full overflow-hidden rounded-2xl border border-white/6 bg-white/[0.04] sm:aspect-video">
                <div className="cinematic-surface absolute inset-0 flex items-center justify-center bg-white/[0.02]">
                  <span
                    className="text-[10px] uppercase tracking-[0.2em] text-white/15"
                    style={{ fontFamily: mono }}
                  >
                    Diagram
                  </span>
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
                  <h3 className="text-xl font-semibold sm:text-2xl" style={{ fontFamily: heading }}>
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/70 sm:text-base">
                    {item.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Same "How It Works" category, more of the technology — kept as a
            distinct carousel design within this section rather than a
            separate section with its own header. */}
        <div className="mt-16">
          <Reveal>
            <div className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p
                  className="text-[10px] uppercase tracking-[0.2em] text-[#8fd1cb]"
                  style={{ fontFamily: mono }}
                >
                  Inside the engine
                </p>
                <h3 className="mt-3 text-2xl font-semibold sm:text-3xl" style={{ fontFamily: heading }}>
                  Technology that disappears into the experience
                </h3>
              </div>
              <p className="max-w-md text-sm leading-relaxed text-white/40 lg:text-right">
                Each layer handles one part of the work, so the person inside the world only has to speak, listen, and choose what happens next.
              </p>
            </div>
          </Reveal>
          <Reveal delay={120} variant="scale">
            <ImageCarousel slides={TECHNOLOGY_SLIDES} initialIndex={3} />
          </Reveal>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative overflow-hidden border-t border-white/6 px-6 py-20 text-center sm:px-10 sm:py-28 lg:px-20">
        <ParallaxLayer className="absolute -inset-y-12 inset-x-0" speed={0.04} maxOffset={24}>
          <MeshGradient />
        </ParallaxLayer>
        <Reveal className="relative z-10" variant="scale">
          <div>
            <h2
              className="text-3xl font-bold sm:text-4xl lg:text-5xl"
              style={{ fontFamily: heading, letterSpacing: "-0.04em" }}
            >
              Welcome to Kawabunga
            </h2>
            <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-white/50 sm:text-base">
              Choose a world, step inside, and discover what happens when every
              choice matters.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/about"
                className="inline-flex items-center justify-center rounded-full bg-[#8fd1cb] px-8 py-3.5 text-sm font-semibold text-[#0a0a0a] transition-all hover:scale-[1.03] hover:brightness-110"
                style={{ fontFamily: mono }}
              >
                Explore Worlds
              </Link>
              <Link
                href="/about"
                className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/8 px-8 py-3.5 text-sm text-white/80 transition-all hover:scale-[1.03] hover:border-white/30 hover:bg-white/15"
                style={{ fontFamily: mono }}
              >
                Read the About
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/6 px-6 py-8 sm:px-10 lg:px-20">
        <Reveal variant="fade">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-between">
            <span
              className="text-sm font-semibold text-white/35"
              style={{ fontFamily: heading }}
            >
              Kawabunga
            </span>
            <div className="flex gap-6 sm:gap-8">
              {[
                { label: "About", href: "/about" },
                { label: "Overview", href: "#what-is-kawabunga" },
                { label: "Experience", href: "#features" },
                { label: "How It Works", href: "#how-it-works" },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="text-xs text-white/30 transition-colors hover:text-white/60"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <span className="text-[11px] text-white/20">
              Built with conviction, not permission.
            </span>
          </div>
        </Reveal>
      </footer>
    </main>
  );
}
