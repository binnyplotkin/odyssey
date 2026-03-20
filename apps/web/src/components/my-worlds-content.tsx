"use client";

import { useState } from "react";
import Link from "next/link";
import type { DashboardWorld } from "@/lib/dashboard-data";

const heading = "var(--font-heading)";
const mono = "var(--font-mono)";

type WorldStatus = "live" | "draft" | "archived";
type FilterTab = "all" | WorldStatus;

const STATUS_CONFIG: Record<WorldStatus, { label: string; dotColor: string; bgColor: string; textColor: string }> = {
  live: { label: "LIVE", dotColor: "#4ade80", bgColor: "rgba(74,222,128,0.15)", textColor: "#4ade80" },
  draft: { label: "DRAFT", dotColor: "#facc15", bgColor: "rgba(250,204,21,0.12)", textColor: "#facc15" },
  archived: { label: "ARCHIVED", dotColor: "#a1a1aa", bgColor: "rgba(161,161,170,0.12)", textColor: "#a1a1aa" },
};

const WORLD_GRADIENTS = [
  "linear-gradient(135deg, #132e2b 0%, #1a4a45 50%, #0f2624 100%)",
  "linear-gradient(135deg, #0c1e3a 0%, #163a5c 50%, #0a1628 100%)",
  "linear-gradient(135deg, #2a1a0e 0%, #4a2e16 50%, #1a0f06 100%)",
  "linear-gradient(135deg, #1a0e2a 0%, #2e1650 50%, #120a28 100%)",
  "linear-gradient(135deg, #2a0e0e 0%, #4a1616 50%, #280a0a 100%)",
  "linear-gradient(135deg, #0e2a1a 0%, #16503a 50%, #0a2812 100%)",
];

function StatusBadge({ status }: { status: WorldStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <div
      className="flex items-center gap-1 rounded-full px-2.5 py-1"
      style={{ background: config.bgColor }}
    >
      <div className="h-1.5 w-1.5 rounded-full" style={{ background: config.dotColor }} />
      <span className="text-[10px] font-medium" style={{ fontFamily: mono, color: config.textColor }}>
        {config.label}
      </span>
    </div>
  );
}

function WorldCard({ world, index }: { world: DashboardWorld; index: number }) {
  const gradient = WORLD_GRADIENTS[index % WORLD_GRADIENTS.length];
  return (
    <Link
      href={`/dashboard/worlds/${world.id}`}
      className="flex flex-col overflow-hidden rounded-2xl border border-white/6 bg-[#161616] transition-all hover:border-white/12 hover:brightness-110"
    >
      <div className="relative h-[130px] w-full" style={{ background: gradient }}>
        <div className="absolute right-3 top-3">
          <StatusBadge status={world.status} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="text-[15px] font-semibold text-white" style={{ fontFamily: heading }}>
          {world.title}
        </h3>
        <p className="line-clamp-2 text-[13px] leading-relaxed text-white/45">
          {world.description}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <span className="text-[10px] text-white/30" style={{ fontFamily: mono }}>
            {world.sessionCount} {world.sessionCount === 1 ? "session" : "sessions"}
          </span>
          <span className="text-[10px] text-white/30" style={{ fontFamily: mono }}>
            {world.lastActivity}
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ filter }: { filter: FilterTab }) {
  const messages: Record<FilterTab, string> = {
    all: "Create your first world and step inside.",
    live: "No live worlds yet. Publish a draft to go live.",
    draft: "No drafts in progress.",
    archived: "No archived worlds.",
  };

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-16 text-center">
      <div className="mb-4 text-white/15">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-white/70" style={{ fontFamily: heading }}>
        {filter === "all" ? "No worlds yet" : `No ${filter} worlds`}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-white/40">{messages[filter]}</p>
      {filter === "all" && (
        <Link
          href="/dashboard/worlds/new"
          className="mt-6 flex items-center gap-2 rounded-xl bg-[#8fd1cb] px-5 py-2.5 text-sm font-semibold text-[#0a0a0a] transition-all hover:brightness-110"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          Create Your First World
        </Link>
      )}
    </div>
  );
}

interface MyWorldsContentProps {
  worlds: DashboardWorld[];
  counts: { all: number; live: number; draft: number; archived: number };
}

export function MyWorldsContent({ worlds, counts }: MyWorldsContentProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");

  const filtered = worlds.filter((w) => {
    if (activeFilter !== "all" && w.status !== activeFilter) return false;
    if (search && !w.title.toLowerCase().includes(search.toLowerCase()) && !w.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "live", label: "Live", count: counts.live },
    { key: "draft", label: "Drafts", count: counts.draft },
    { key: "archived", label: "Archived", count: counts.archived },
  ];

  return (
    <div className="flex h-full flex-col gap-5 p-5 md:gap-8 md:p-8 lg:p-10">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h1
            className="text-2xl font-semibold text-white md:text-[28px]"
            style={{ fontFamily: heading, letterSpacing: "-0.03em" }}
          >
            My Worlds
          </h1>
          <p className="text-[13px] text-white/40 md:text-sm">
            {counts.all === 0
              ? "Ready to create your first world"
              : `${counts.all} ${counts.all === 1 ? "world" : "worlds"} · ${counts.live} live · ${counts.draft} ${counts.draft === 1 ? "draft" : "drafts"}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="flex flex-1 items-center gap-2 rounded-[10px] border border-white/8 bg-white/[0.03] px-3.5 py-2.5 md:flex-initial md:py-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="shrink-0 text-white/35">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search worlds..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-[13px] text-white/80 placeholder:text-white/30 outline-none md:w-40"
            />
          </div>
          {/* Create — hidden on mobile, shown on desktop */}
          <Link
            href="/dashboard/worlds/new"
            className="hidden items-center gap-2 rounded-xl bg-[#8fd1cb] px-5 py-2.5 text-sm font-semibold text-[#0a0a0a] transition-all hover:brightness-110 md:flex"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Create World
          </Link>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`rounded-lg px-4 py-2 text-[13px] transition-colors ${
              activeFilter === tab.key
                ? "bg-white/8 font-medium text-white/85"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState filter={activeFilter} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((world, i) => (
            <WorldCard key={world.id} world={world} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
