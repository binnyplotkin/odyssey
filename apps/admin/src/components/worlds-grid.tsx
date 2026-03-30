"use client";

import { useState, useMemo } from "react";
import type { WorldDefinition } from "@odyssey/types";

/* ── Design tokens ───────────────────────────────────────── */

const T = {
  bg: "var(--background)",
  panel: "var(--panel)",
  border: "var(--border)",
  fg: "var(--foreground)",
  muted: "var(--muted)",
  accent: "var(--accent)",
  accentStrong: "var(--accent-strong, var(--accent))",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
} as const;

/* ── Gradient presets for card headers ────────────────────── */

const GRADIENTS = [
  "linear-gradient(135deg, #105A59 0%, #1a3a3a 50%, #0f2828 100%)",
  "linear-gradient(135deg, #2a1a4a 0%, #1a1035 50%, #0f0a22 100%)",
  "linear-gradient(135deg, #3a1a1a 0%, #2a1018 50%, #1a0a12 100%)",
  "linear-gradient(135deg, #1a2a4a 0%, #101830 50%, #080e1a 100%)",
  "linear-gradient(135deg, #2a2a1a 0%, #1a1808 50%, #121008 100%)",
  "linear-gradient(135deg, #1a3a2a 0%, #0f2218 50%, #081510 100%)",
  "linear-gradient(135deg, #3a2a1a 0%, #2a1a10 50%, #1a1008 100%)",
  "linear-gradient(135deg, #1a1a3a 0%, #101028 50%, #08081a 100%)",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/* ── Tag color assignment ────────────────────────────────── */

const TAG_COLORS = [
  { bg: "rgba(141,240,200,0.1)", fg: "var(--accent-strong, #8CE7D2)" },
  { bg: "rgba(107,138,255,0.1)", fg: "#6B8AFF" },
  { bg: "rgba(232,121,160,0.1)", fg: "#E879A0" },
  { bg: "rgba(244,148,77,0.1)", fg: "#F4944D" },
  { bg: "rgba(168,140,255,0.1)", fg: "#A88CFF" },
  { bg: "rgba(244,204,21,0.1)", fg: "#F4CC15" },
];

function tagColor(tag: string) {
  return TAG_COLORS[hashString(tag) % TAG_COLORS.length];
}

/* ── Status helpers ──────────────────────────────────────── */

type Status = "live" | "draft" | "archived";

function inferStatus(_world: WorldDefinition): Status {
  // Infer status heuristically — worlds with complete data are "live"
  const hasRoles = _world.roles.length > 0;
  const hasChars = _world.characters.length > 0;
  const hasGroups = _world.groups.length > 0;
  const hasEvents = _world.eventTemplates.length > 0;
  if (hasRoles && hasChars && hasGroups && hasEvents) return "live";
  return "draft";
}

const STATUS_STYLES: Record<Status, { bg: string; color: string; label: string }> = {
  live: { bg: "rgba(74,222,128,0.15)", color: "#4ade80", label: "LIVE" },
  draft: { bg: "rgba(255,215,0,0.12)", color: "#FFD700", label: "DRAFT" },
  archived: { bg: "rgba(156,163,175,0.12)", color: "#9ca3af", label: "ARCHIVED" },
};

/* ── Types ───────────────────────────────────────────────── */

type Filter = "all" | Status;
type SortBy = "title" | "modified" | "characters" | "events";
type ViewMode = "grid" | "list";

type Props = {
  worlds: WorldDefinition[];
};

/* ── Component ───────────────────────────────────────────── */

export function WorldsGrid({ worlds }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("title");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const worldsWithStatus = useMemo(
    () => worlds.map((w) => ({ world: w, status: inferStatus(w) })),
    [worlds],
  );

  const filtered = useMemo(() => {
    let result = worldsWithStatus;

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        ({ world }) =>
          world.title.toLowerCase().includes(q) ||
          world.id.toLowerCase().includes(q) ||
          world.setting.toLowerCase().includes(q),
      );
    }

    // Filter
    if (filter !== "all") {
      result = result.filter(({ status }) => status === filter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "title": return a.world.title.localeCompare(b.world.title);
        case "characters": return b.world.characters.length - a.world.characters.length;
        case "events": return b.world.eventTemplates.length - a.world.eventTemplates.length;
        default: return 0;
      }
    });

    return result;
  }, [worldsWithStatus, search, filter, sortBy]);

  const filterCounts = useMemo(() => {
    const counts: Record<Filter, number> = { all: worldsWithStatus.length, live: 0, draft: 0, archived: 0 };
    for (const { status } of worldsWithStatus) counts[status]++;
    return counts;
  }, [worldsWithStatus]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "live", label: "Live" },
    { key: "draft", label: "Draft" },
    { key: "archived", label: "Archived" },
  ];

  const sorts: { key: SortBy; label: string }[] = [
    { key: "title", label: "Title" },
    { key: "characters", label: "Characters" },
    { key: "events", label: "Events" },
  ];

  /* ── Extract tags from world ─────────────────────────────── */

  function getWorldTags(world: WorldDefinition): string[] {
    const tags: string[] = [];
    // Add event categories as tags
    const categories = new Set(world.eventTemplates.map((e) => e.category));
    categories.forEach((c) => tags.push(c));
    // Add v2 badge if world has metrics
    if (world.metrics?.length) tags.push("v2");
    return tags.slice(0, 4);
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: 0 }}>Worlds</h1>
          <span style={{ fontFamily: T.fontMono, fontSize: "0.75rem", color: T.muted }}>
            {worlds.length} total
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "0.5rem 1rem", borderRadius: 8,
              border: `1px solid ${T.border}`, background: "transparent",
              fontSize: "0.8125rem", color: T.muted, cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            Import
          </button>
          <a
            href="/world-editor"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "0.5rem 1rem", borderRadius: 8,
              border: "none", background: T.accentStrong,
              fontSize: "0.8125rem", fontWeight: 600, color: "var(--background)", cursor: "pointer",
              textDecoration: "none",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            New World
          </a>
        </div>
      </div>

      {/* Search + Filters bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: "1.25rem",
        flexWrap: "wrap",
      }}>
        {/* Search input */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0.5rem 0.75rem", borderRadius: 8,
          background: T.panel, border: `1px solid ${T.border}`,
          width: 280,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke={T.muted} strokeWidth="1.5" />
            <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke={T.muted} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search worlds…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, border: "none", background: "transparent", outline: "none",
              fontSize: "0.8125rem", color: T.fg,
            }}
          />
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                padding: "0.375rem 0.875rem", borderRadius: 9999,
                border: filter === f.key ? "none" : `1px solid ${T.border}`,
                background: filter === f.key ? "rgba(255,255,255,0.08)" : "transparent",
                fontSize: "0.75rem", fontWeight: filter === f.key ? 500 : 400,
                color: filter === f.key ? T.fg : T.muted,
                cursor: "pointer",
              }}
            >
              {f.label}
              {filterCounts[f.key] > 0 && f.key !== "all" && (
                <span style={{ marginLeft: 4, opacity: 0.7 }}>{filterCounts[f.key]}</span>
              )}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Sort */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: T.muted }}>
          Sort by
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            style={{
              padding: "0.3rem 0.5rem", borderRadius: 6,
              border: `1px solid ${T.border}`, background: "transparent",
              color: T.fg, fontSize: "0.75rem", outline: "none", cursor: "pointer",
            }}
          >
            {sorts.map((s) => (
              <option key={s.key} value={s.key} style={{ background: "var(--panel)", color: T.fg }}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* View toggle */}
        <div style={{ display: "flex", borderRadius: 6, border: `1px solid ${T.border}`, overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            style={{
              padding: "0.375rem 0.5rem", border: "none", cursor: "pointer",
              background: viewMode === "grid" ? "rgba(255,255,255,0.08)" : "transparent",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" stroke={viewMode === "grid" ? T.fg : T.muted} strokeWidth="1.2" />
              <rect x="8" y="1" width="5" height="5" rx="1" stroke={viewMode === "grid" ? T.fg : T.muted} strokeWidth="1.2" />
              <rect x="1" y="8" width="5" height="5" rx="1" stroke={viewMode === "grid" ? T.fg : T.muted} strokeWidth="1.2" />
              <rect x="8" y="8" width="5" height="5" rx="1" stroke={viewMode === "grid" ? T.fg : T.muted} strokeWidth="1.2" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            style={{
              padding: "0.375rem 0.5rem", border: "none", cursor: "pointer",
              background: viewMode === "list" ? "rgba(255,255,255,0.08)" : "transparent",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="1" y1="3" x2="13" y2="3" stroke={viewMode === "list" ? T.fg : T.muted} strokeWidth="1.2" strokeLinecap="round" />
              <line x1="1" y1="7" x2="13" y2="7" stroke={viewMode === "list" ? T.fg : T.muted} strokeWidth="1.2" strokeLinecap="round" />
              <line x1="1" y1="11" x2="13" y2="11" stroke={viewMode === "list" ? T.fg : T.muted} strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Results count */}
      {search.trim() && (
        <div style={{ fontSize: "0.75rem", color: T.muted, marginBottom: "1rem" }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for &ldquo;{search}&rdquo;
        </div>
      )}

      {/* Grid / List view */}
      {viewMode === "grid" ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          gap: 16,
        }}>
          {filtered.map(({ world, status }) => (
            <WorldCard key={world.id} world={world} status={status} tags={getWorldTags(world)} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* List header */}
          <div style={{
            display: "flex", alignItems: "center", padding: "0.5rem 1rem", gap: "1rem",
            fontSize: "0.6875rem", color: T.muted, fontFamily: T.fontMono,
            fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            <span style={{ flex: 2 }}>Title</span>
            <span style={{ width: 100 }}>Status</span>
            <span style={{ width: 60, textAlign: "center" }}>Roles</span>
            <span style={{ width: 60, textAlign: "center" }}>Chars</span>
            <span style={{ width: 60, textAlign: "center" }}>Groups</span>
            <span style={{ width: 60, textAlign: "center" }}>Events</span>
            <span style={{ width: 100 }}>ID</span>
          </div>
          {filtered.map(({ world, status }) => (
            <WorldRow key={world.id} world={world} status={status} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "4rem 2rem", gap: 12,
        }}>
          <div style={{ fontSize: "1rem", fontWeight: 600 }}>No worlds found</div>
          <div style={{ fontSize: "0.8125rem", color: T.muted }}>
            {search.trim() ? "Try a different search term." : "Create your first world to get started."}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── World Card ──────────────────────────────────────────── */

function WorldCard({ world, status, tags }: { world: WorldDefinition; status: Status; tags: string[] }) {
  const gradient = GRADIENTS[hashString(world.id) % GRADIENTS.length];
  const statusStyle = STATUS_STYLES[status];

  const stats = [
    { label: "ROLES", value: world.roles.length },
    { label: "CHARACTERS", value: world.characters.length },
    { label: "GROUPS", value: world.groups.length },
    { label: "EVENTS", value: world.eventTemplates.length },
  ];

  return (
    <a
      href={`/worlds/${world.id}`}
      style={{
        display: "flex", flexDirection: "column",
        borderRadius: 12, overflow: "hidden",
        background: T.panel, border: `1px solid ${T.border}`,
        textDecoration: "none", color: "inherit",
        transition: "border-color 150ms, box-shadow 150ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = T.border;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Gradient header */}
      <div style={{
        height: 100, background: gradient, position: "relative",
        padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}>
        <span style={{
          position: "absolute", top: 12, right: 12,
          padding: "3px 10px", borderRadius: 9999,
          background: statusStyle.bg,
          fontFamily: T.fontMono, fontSize: "0.5625rem", fontWeight: 700,
          color: statusStyle.color, letterSpacing: "0.06em",
        }}>
          {statusStyle.label}
        </span>
        <div style={{ fontSize: "1.0625rem", fontWeight: 700 }}>
          {world.title}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{
          fontSize: "0.75rem", color: T.muted, lineHeight: 1.5,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {world.setting.length > 120 ? world.setting.slice(0, 118) + "…" : world.setting}
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 16 }}>
          {stats.map((stat) => (
            <div key={stat.label}>
              <div style={{
                fontFamily: T.fontMono, fontSize: "0.5625rem",
                color: T.muted, letterSpacing: "0.06em",
              }}>
                {stat.label}
              </div>
              <div style={{ fontSize: "1rem", fontWeight: 600 }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {tags.map((tag) => {
              const tc = tagColor(tag);
              return (
                <span key={tag} style={{
                  padding: "2px 8px", borderRadius: 4,
                  background: tc.bg, fontFamily: T.fontMono,
                  fontSize: "0.5625rem", color: tc.fg,
                }}>
                  {tag}
                </span>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingTop: 8, borderTop: `1px solid ${T.border}`,
        }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "0.625rem", color: T.muted }}>
            {world.id}
          </span>
          <span style={{ fontSize: "0.6875rem", color: T.muted }}>
            {world.characters.length + world.groups.length + world.eventTemplates.length} entities
          </span>
        </div>
      </div>
    </a>
  );
}

/* ── World Row (list view) ───────────────────────────────── */

function WorldRow({ world, status }: { world: WorldDefinition; status: Status }) {
  const statusStyle = STATUS_STYLES[status];

  return (
    <a
      href={`/worlds/${world.id}`}
      style={{
        display: "flex", alignItems: "center", padding: "0.625rem 1rem", gap: "1rem",
        borderRadius: 8, textDecoration: "none", color: "inherit",
        transition: "background 100ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = T.panel; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ flex: 2, fontWeight: 500, fontSize: "0.875rem" }}>
        {world.title}
      </span>
      <span style={{ width: 100 }}>
        <span style={{
          padding: "2px 8px", borderRadius: 9999,
          background: statusStyle.bg, fontFamily: T.fontMono,
          fontSize: "0.5625rem", fontWeight: 700, color: statusStyle.color,
          letterSpacing: "0.06em",
        }}>
          {statusStyle.label}
        </span>
      </span>
      <span style={{ width: 60, textAlign: "center", fontSize: "0.8125rem" }}>{world.roles.length}</span>
      <span style={{ width: 60, textAlign: "center", fontSize: "0.8125rem" }}>{world.characters.length}</span>
      <span style={{ width: 60, textAlign: "center", fontSize: "0.8125rem" }}>{world.groups.length}</span>
      <span style={{ width: 60, textAlign: "center", fontSize: "0.8125rem" }}>{world.eventTemplates.length}</span>
      <span style={{ width: 100, fontFamily: T.fontMono, fontSize: "0.6875rem", color: T.muted }}>
        {world.id}
      </span>
    </a>
  );
}
