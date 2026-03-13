"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GoogleAuthButton } from "./google-auth-button";

/**
 * Progressive image tiers ordered from smallest to largest.
 * Each tier loads only after the previous one is visible, creating a
 * seamless quality ramp from a 908 B placeholder to the full 8.5 MB original.
 */
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
    // Determine the maximum tier this device should load based on viewport width.
    const vw = window.innerWidth * (window.devicePixelRatio ?? 1);
    let maxTier = HERO_TIERS.length - 1;
    for (let i = HERO_TIERS.length - 1; i > 0; i--) {
      if (vw < HERO_TIERS[i].minWidth) {
        maxTier = i - 1;
      }
    }

    let cancelled = false;
    let current = 0;

    function advance() {
      if (cancelled || current >= maxTier) return;
      const next = current + 1;
      const img = new window.Image();
      img.src = HERO_TIERS[next].src;
      img.onload = () => {
        if (cancelled) return;
        current = next;
        setTierIndex(next);
        // Small delay before starting next tier to let the browser breathe.
        setTimeout(advance, 80);
      };
      // If a tier fails to load, stop upgrading — the current tier stays.
      img.onerror = () => {};
    }

    // Kick off the first upgrade once the placeholder is painted.
    const kickoff = requestAnimationFrame(() => {
      setReady(true);
      advance();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(kickoff);
    };
  }, []);

  return { src: HERO_TIERS[tierIndex].src, ready, isPlaceholder: tierIndex === 0 };
}

export function LandingPageV3() {
  const hero = useProgressiveHero();

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      {/* Hero background image — progressively upgraded */}
      <div className="absolute inset-0">
        <Image
          src={hero.src}
          alt="Immersive digital forest — streams of light and data flowing through ancient trees"
          fill
          className={`object-cover transition-[filter] duration-700 ${hero.isPlaceholder ? "blur-xl scale-105" : ""}`}
          priority
          quality={90}
          sizes="100vw"
        />
        {/* Gradient overlays for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />
      </div>

      {/* Content layer */}
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-5 sm:px-10">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span
              className="text-xl font-bold tracking-tight"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Odyssey
            </span>
          </Link>

          {/* Center nav */}
          <nav className="hidden items-center gap-2 md:flex">
            <Link
              href="/about"
              className="rounded-full border border-white/15 bg-white/8 px-5 py-1.5 text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] backdrop-blur-md transition-all hover:border-white/30 hover:bg-white/15 hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              About
            </Link>
          </nav>

          {/* Right CTAs */}
          <div className="flex items-center gap-2">
            <GoogleAuthButton />
          </div>
        </header>

        {/* Spacer + Stats */}
        <div className="flex flex-1 flex-col justify-between px-6 pb-10 sm:px-10">
          {/* Stats - upper right area */}
          <div className="flex justify-end pt-12 sm:pt-20">
            <div className="flex gap-10">
              <div className="text-right">
                <p
                  className="text-5xl font-bold tracking-tight sm:text-6xl"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  10k+
                </p>
                <p
                  className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/60"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  Worlds Created
                </p>
              </div>
              <div className="text-right">
                <p
                  className="text-5xl font-bold tracking-tight sm:text-6xl"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  &infin;
                </p>
                <p
                  className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/60"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  Possibilities
                </p>
              </div>
            </div>
          </div>

          {/* Bottom content area */}
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            {/* Headline - bottom left */}
            <div className="max-w-xl space-y-6">
              <h1
                className="text-4xl font-semibold leading-[1.1] sm:text-5xl lg:text-6xl"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <span style={{ color: "#8fd1cb" }}>Step into any world</span>
                <br />
                you can imagine
              </h1>

              {/* CTA buttons */}
              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="/about"
                  className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-6 py-2.5 text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_4px_20px_rgba(0,0,0,0.2)] backdrop-blur-lg transition-all hover:scale-[1.03] hover:border-white/40 hover:bg-white/25 hover:shadow-[inset_0_1px_2px_rgba(255,255,255,0.2),0_4px_24px_rgba(0,0,0,0.25)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  Explore Worlds
                  <span className="text-white/60">&rarr;</span>
                </Link>
                <Link
                  href="/about"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-6 py-2.5 text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_4px_20px_rgba(0,0,0,0.15)] backdrop-blur-md transition-all hover:scale-[1.03] hover:border-white/30 hover:bg-white/15 hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_4px_24px_rgba(0,0,0,0.2)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  Learn More
                  <span className="text-white/60">&rarr;</span>
                </Link>
              </div>
            </div>

            {/* Body text - bottom right */}
            <p
              className="max-w-md text-sm leading-relaxed text-white/70 lg:text-base"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              A voice-first immersive reality engine where you inhabit
              characters, shape narratives, and experience worlds that respond
              to every choice you make. Built with AI that remembers, adapts,
              and surprises.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
