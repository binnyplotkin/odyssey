"use client";

import Link from "next/link";
import type { DashboardWorld, DashboardStats, ActivityItem } from "@/lib/dashboard-data";

const heading = "var(--font-heading)";
const mono = "var(--font-mono)";

type WorldStatus = "live" | "draft" | "archived";

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

const ACTIVITY_COLORS: Record<ActivityItem["type"], string> = {
  world_created: "#8fd1cb",
  world_updated: "#facc15",
  session_played: "#4ade80",
};

const ACTIVITY_LABELS: Record<ActivityItem["type"], string> = {
  world_created: "Created new world",
  world_updated: "Updated",
  session_played: "Played session in",
};

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
      <div className="relative h-[90px] w-full md:h-[140px]" style={{ background: gradient }}>
        <div className="absolute right-3 top-3">
          <StatusBadge status={world.status} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="text-base font-semibold text-white" style={{ fontFamily: heading }}>
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

function EmptyWorldsState() {
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
        No worlds yet
      </h3>
      <p className="mt-1 max-w-sm text-sm text-white/40">
        Create your first world and step inside. Describe any scenario — the engine will bring it to life.
      </p>
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
    </div>
  );
}

function StatCard({ value, label, icon }: { value: string | number; label: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/6 bg-[#161616] p-3.5 md:p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[22px] font-semibold text-white md:text-2xl" style={{ fontFamily: heading }}>
          {value}
        </span>
        <span className="text-[11px] text-white/35 md:text-xs">{label}</span>
      </div>
      {icon && <div className="text-white/15">{icon}</div>}
    </div>
  );
}

interface DashboardContentProps {
  firstName: string;
  worlds: DashboardWorld[];
  stats: DashboardStats;
  activity: ActivityItem[];
}

export function DashboardContent({ firstName, worlds, stats, activity }: DashboardContentProps) {
  const draftCount = worlds.filter((w) => w.status === "draft").length;
  const liveCount = worlds.filter((w) => w.status === "live").length;

  return (
    <div className="flex h-full flex-col gap-6 p-5 md:gap-8 md:p-8 lg:p-10">
      {/* Top Bar */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1
            className="text-2xl font-semibold text-white md:text-[28px]"
            style={{ fontFamily: heading, letterSpacing: "-0.03em" }}
          >
            Welcome back, {firstName}
          </h1>
          <p className="text-[13px] text-white/40 md:text-sm">
            {worlds.length === 0
              ? "Ready to create your first world"
              : `${draftCount} in progress · ${liveCount} live`}
          </p>
        </div>
        <Link
          href="/dashboard/worlds/new"
          className="flex items-center justify-center gap-2 rounded-xl bg-[#8fd1cb] px-5 py-3 text-sm font-semibold text-[#0a0a0a] transition-all hover:brightness-110 md:w-fit md:py-2.5"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          Create World
        </Link>
      </div>

      {/* Recent Worlds */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.2em] text-white/35" style={{ fontFamily: mono }}>
            Recent Worlds
          </span>
          {worlds.length > 0 && (
            <Link href="/dashboard/worlds" className="text-[13px] text-white/40 transition-colors hover:text-white/60">
              View all &rarr;
            </Link>
          )}
        </div>
        {worlds.length === 0 ? (
          <EmptyWorldsState />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:pb-0 lg:grid-cols-3">
            {worlds.slice(0, 3).map((world, i) => (
              <div key={world.id} className="w-[220px] shrink-0 md:w-auto">
                <WorldCard world={world} index={i} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats — compact row on mobile, sidebar on desktop */}
      <div className="grid grid-cols-3 gap-2 md:hidden">
        <StatCard value={stats.totalWorlds} label="Worlds" icon={null} />
        <StatCard value={stats.sessionsPlayed} label="Sessions" icon={null} />
        <StatCard value={stats.totalTurns} label="Turns" icon={null} />
      </div>

      {/* Stats + Activity — desktop layout */}
      <div className="flex flex-1 flex-col gap-4 overflow-hidden md:flex-row">
        {/* Stats — desktop only */}
        <div className="hidden w-[280px] shrink-0 flex-col gap-3 md:flex">
          <span className="text-[11px] uppercase tracking-[0.2em] text-white/35" style={{ fontFamily: mono }}>
            Stats
          </span>
          <div className="flex flex-col gap-2">
            <StatCard
              value={stats.totalWorlds}
              label="Total Worlds"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              }
            />
            <StatCard
              value={stats.sessionsPlayed}
              label="Sessions Played"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 6v6l4 2" />
                  <circle cx="12" cy="12" r="10" />
                </svg>
              }
            />
            <StatCard
              value={stats.totalTurns}
              label="Total Turns"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M5 3l14 9-14 9V3z" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Activity */}
        <div className="flex flex-1 flex-col gap-3 overflow-hidden">
          <span className="text-[11px] uppercase tracking-[0.2em] text-white/35" style={{ fontFamily: mono }}>
            Recent Activity
          </span>
          {activity.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02]">
              <p className="text-sm text-white/30">No activity yet. Create a world to get started.</p>
            </div>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-xl">
              {activity.map((item, i) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 bg-[#161616] px-4 py-3.5 ${
                    i > 0 ? "border-t border-white/[0.03]" : ""
                  }`}
                >
                  <div
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: ACTIVITY_COLORS[item.type] }}
                  />
                  <p className="flex-1 text-[13px] text-white/70">
                    {ACTIVITY_LABELS[item.type]}{" "}
                    <span className="font-medium text-white">{item.worldTitle}</span>
                  </p>
                  <span className="shrink-0 text-[11px] text-white/25" style={{ fontFamily: mono }}>
                    {item.time}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
