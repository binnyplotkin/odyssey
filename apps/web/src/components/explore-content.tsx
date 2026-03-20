"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { ExploreWorld } from "@/lib/dashboard-data";

const heading = "var(--font-heading)";
const mono = "var(--font-mono)";

const CATEGORIES = ["All", "Fantasy", "Sci-Fi", "Historical", "Mystery", "Horror", "Education"] as const;

const EXPLORE_GRADIENTS = [
  "linear-gradient(135deg, #1a0e2a 0%, #2e1650 50%, #120a28 100%)",
  "linear-gradient(135deg, #2a0e0e 0%, #4a1616 50%, #280a0a 100%)",
  "linear-gradient(135deg, #132e2b 0%, #1a4a45 50%, #0f2624 100%)",
  "linear-gradient(135deg, #0c1e3a 0%, #163a5c 50%, #0a1628 100%)",
  "linear-gradient(135deg, #2a1a0e 0%, #4a2e16 50%, #1a0f06 100%)",
  "linear-gradient(135deg, #0e2a1a 0%, #16503a 50%, #0a2812 100%)",
];

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #2e1650, #8fd1cb)",
  "linear-gradient(135deg, #4a1616, #facc15)",
  "linear-gradient(135deg, #1a4a45, #4ade80)",
  "linear-gradient(135deg, #163a5c, #8fd1cb)",
  "linear-gradient(135deg, #4a2e16, #8fd1cb)",
  "linear-gradient(135deg, #2e1650, #facc15)",
];

function AuthorAvatar({ name, image, size = 16, gradientIndex = 0 }: { name: string; image: string | null; size?: number; gradientIndex?: number }) {
  if (image) {
    return <Image src={image} alt="" width={size} height={size} className="shrink-0 rounded-full" />;
  }
  return (
    <div
      className="shrink-0 rounded-full"
      style={{ width: size, height: size, background: AVATAR_GRADIENTS[gradientIndex % AVATAR_GRADIENTS.length] }}
    />
  );
}

function FeaturedCard({ world }: { world: ExploreWorld }) {
  return (
    <Link
      href={`/dashboard/explore/${world.id}`}
      className="flex flex-col overflow-hidden rounded-2xl border border-white/6 bg-[#161616] transition-all hover:border-white/12 hover:brightness-110 md:flex-row"
    >
      <div
        className="relative h-[120px] w-full shrink-0 md:h-auto md:w-[340px]"
        style={{ background: "linear-gradient(135deg, #0e2a1a 0%, #16503a 40%, #1a4a45 70%, #8fd1cb 100%)" }}
      >
        <div className="absolute bottom-4 left-5 flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: "rgba(143,209,203,0.2)", backdropFilter: "blur(8px)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#8fd1cb" stroke="none">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span className="text-[10px] font-medium text-[#8fd1cb]" style={{ fontFamily: mono }}>FEATURED</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-3.5 md:gap-2.5 md:p-7">
        <h3
          className="text-[17px] font-semibold text-white md:text-[22px]"
          style={{ fontFamily: heading, letterSpacing: "-0.02em" }}
        >
          {world.title}
        </h3>
        <p className="text-sm leading-relaxed text-white/45">
          {world.description}
        </p>
        <div className="mt-1 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <AuthorAvatar name={world.authorName} image={world.authorImage} size={20} gradientIndex={0} />
            <span className="text-xs text-white/50">by {world.authorName}</span>
          </div>
          <span className="text-[11px] text-white/30" style={{ fontFamily: mono }}>
            {world.playCount.toLocaleString()} {world.playCount === 1 ? "play" : "plays"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function ExploreCard({ world, index }: { world: ExploreWorld; index: number }) {
  const gradient = EXPLORE_GRADIENTS[index % EXPLORE_GRADIENTS.length];
  return (
    <Link
      href={`/dashboard/explore/${world.id}`}
      className="flex flex-col overflow-hidden rounded-[14px] border border-white/6 bg-[#161616] transition-all hover:border-white/12 hover:brightness-110"
    >
      <div className="h-[100px] w-full" style={{ background: gradient }} />
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <h3 className="text-[15px] font-semibold text-white" style={{ fontFamily: heading }}>
          {world.title}
        </h3>
        <p className="line-clamp-2 text-xs leading-relaxed text-white/40">
          {world.description}
        </p>
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AuthorAvatar name={world.authorName} image={world.authorImage} gradientIndex={index} />
            <span className="text-[11px] text-white/40">{world.authorName}</span>
          </div>
          <span className="text-[10px] text-white/25" style={{ fontFamily: mono }}>
            {world.playCount.toLocaleString()} {world.playCount === 1 ? "play" : "plays"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyExploreState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-16 text-center">
      <div className="mb-4 text-white/15">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-white/70" style={{ fontFamily: heading }}>
        No worlds to explore yet
      </h3>
      <p className="mt-1 max-w-sm text-sm text-white/40">
        Community worlds will appear here once other creators publish their work.
      </p>
    </div>
  );
}

interface ExploreContentProps {
  worlds: ExploreWorld[];
  featured: ExploreWorld | null;
}

export function ExploreContent({ worlds, featured }: ExploreContentProps) {
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");

  const filtered = worlds.filter((w) => {
    if (search && !w.title.toLowerCase().includes(search.toLowerCase()) && !w.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Remove featured world from the grid if it exists
  const gridWorlds = featured
    ? filtered.filter((w) => w.id !== featured.id)
    : filtered;

  return (
    <div className="flex h-full flex-col gap-5 p-5 md:gap-8 md:p-8 lg:p-10">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h1
            className="text-2xl font-semibold text-white md:text-[28px]"
            style={{ fontFamily: heading, letterSpacing: "-0.03em" }}
          >
            Explore
          </h1>
          <p className="text-[13px] text-white/40 md:text-sm">Discover worlds built by the community</p>
        </div>
        <div className="flex items-center gap-2 rounded-[10px] border border-white/8 bg-white/[0.03] px-3.5 py-2.5 md:w-[280px] md:py-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="shrink-0 text-white/35">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search worlds, genres, themes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-[13px] text-white/80 placeholder:text-white/30 outline-none"
          />
        </div>
      </div>

      {/* Category Tags */}
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
              activeCategory === cat
                ? "bg-white/8 font-medium text-white/85"
                : "border border-white/8 text-white/40 hover:text-white/60"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {worlds.length === 0 && !featured ? (
        <EmptyExploreState />
      ) : (
        <>
          {/* Featured */}
          {featured && (
            <div className="flex flex-col gap-4">
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/35" style={{ fontFamily: mono }}>
                Featured
              </span>
              <FeaturedCard world={featured} />
            </div>
          )}

          {/* Community Grid */}
          {gridWorlds.length > 0 && (
            <div className="flex flex-col gap-4">
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/35" style={{ fontFamily: mono }}>
                Community Worlds
              </span>
              <div className="grid grid-cols-2 gap-2.5 md:gap-4 lg:grid-cols-4">
                {gridWorlds.map((world, i) => (
                  <ExploreCard key={world.id} world={world} index={i} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
