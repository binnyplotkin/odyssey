"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useHeaderContent } from "@/components/header-context";
import type { WorldDefinition } from "@odyssey/types";

/* ── Design tokens ───────────────────────────────────────── */

const T = {
  bg: "var(--background)",
  panel: "var(--surface-1)",
  border: "var(--border)",
  fg: "var(--foreground)",
  muted: "var(--text-tertiary)",
  accent: "var(--accent)",
  accentStrong: "var(--accent-strong, var(--accent))",
  fontHeading: "'Space Grotesk', system-ui, sans-serif",
  fontBody: "'Inter', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

/* ── Gradient presets for card headers ────────────────────── */

const GRADIENTS = [
  "radial-gradient(circle at 25% 18%, color-mix(in srgb, var(--emissive-mint) 18%, transparent), transparent 38%), linear-gradient(135deg, #111417 0%, #0D1013 56%, #07090B 100%)",
  "radial-gradient(circle at 76% 26%, color-mix(in srgb, var(--event-violet) 16%, transparent), transparent 36%), linear-gradient(135deg, #151A1E 0%, #101319 56%, #07090B 100%)",
  "radial-gradient(circle at 28% 28%, color-mix(in srgb, var(--warning-amber) 13%, transparent), transparent 36%), linear-gradient(135deg, #151A1E 0%, #111417 54%, #07090B 100%)",
  "radial-gradient(circle at 76% 22%, color-mix(in srgb, var(--signal-blue) 17%, transparent), transparent 35%), linear-gradient(135deg, #111827 0%, #0D1013 58%, #07090B 100%)",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/* ── Status helpers ──────────────────────────────────────── */

type Status = "live" | "draft" | "archived";

function inferStatus(world: WorldDefinition): Status {
  const hasRoles = world.roles.length > 0;
  const hasChars = world.characters.length > 0;
  const hasGroups = world.groups.length > 0;
  const hasEvents = world.eventTemplates.length > 0;
  if (hasRoles && hasChars && hasGroups && hasEvents) return "live";
  return "draft";
}

const STATUS_STYLES: Record<Status, { dot: string; color: string; label: string }> = {
  live: { dot: "var(--status-live)", color: "var(--status-live)", label: "Live" },
  draft: { dot: "var(--status-draft)", color: "var(--status-draft)", label: "Draft" },
  archived: { dot: "var(--status-archived)", color: "var(--status-archived)", label: "Archived" },
};

/* ── Derived helpers ─────────────────────────────────────── */

function slugFromId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function splitSubtitle(setting: string): { tagline: string; body: string } {
  const trimmed = setting.trim();
  const firstBreak = trimmed.search(/[.·;]\s/);
  if (firstBreak === -1 || firstBreak > 60) {
    return { tagline: trimmed.slice(0, 60), body: trimmed };
  }
  const tagline = trimmed.slice(0, firstBreak).trim();
  const body = trimmed.slice(firstBreak + 1).trim();
  return { tagline, body };
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "•";
}

const AVATAR_COLORS = [
  { bg: "color-mix(in srgb, var(--accent-strong) 18%, transparent)", fg: "var(--accent-strong)" },
  { bg: "color-mix(in srgb, var(--critical-crimson) 16%, transparent)", fg: "var(--critical-crimson)" },
  { bg: "color-mix(in srgb, var(--signal-blue) 18%, transparent)", fg: "var(--signal-blue)" },
  { bg: "color-mix(in srgb, var(--warning-amber) 18%, transparent)", fg: "var(--warning-amber)" },
  { bg: "color-mix(in srgb, var(--event-violet) 18%, transparent)", fg: "var(--event-violet)" },
];

function avatarColor(seed: string) {
  return AVATAR_COLORS[hashString(seed) % AVATAR_COLORS.length];
}

/* ── Types ───────────────────────────────────────────────── */

type Filter = "all" | Status;
type SortBy = "title" | "characters" | "events";

type Props = {
  worlds: WorldDefinition[];
};

/* ── Component ───────────────────────────────────────────── */

export function WorldsGrid({ worlds }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("title");

  const worldsWithStatus = useMemo(
    () => worlds.map((w) => ({ world: w, status: inferStatus(w) })),
    [worlds],
  );

  const filtered = useMemo(() => {
    let result = worldsWithStatus;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        ({ world }) =>
          world.title.toLowerCase().includes(q) ||
          world.id.toLowerCase().includes(q) ||
          world.setting.toLowerCase().includes(q),
      );
    }
    if (filter !== "all") result = result.filter(({ status }) => status === filter);
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

  const filters: { key: Filter; label: string; dot?: string }[] = [
    { key: "all", label: "All" },
    { key: "live", label: "Live", dot: STATUS_STYLES.live.dot },
    { key: "draft", label: "Draft", dot: STATUS_STYLES.draft.dot },
  ];

  const sorts: { key: SortBy; label: string }[] = [
    { key: "title", label: "Title" },
    { key: "characters", label: "Characters" },
    { key: "events", label: "Events" },
  ];

  /* ── Header injection ───────────────────────────────────── */

  const { setContent } = useHeaderContent();
  useEffect(() => {
    setContent(
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          minWidth: 0,
        }}
      >
        <h1 style={{
          fontSize: "var(--font-size-xl)", fontWeight: 700, color: T.fg,
          marginTop: 0, marginRight: "var(--space-12)", marginBottom: 0, marginLeft: 0,
          whiteSpace: "nowrap", fontFamily: T.fontHeading,
        }}>
          Worlds
        </h1>
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
          <RefreshButton />
          <Link
            href="/worlds/new"
            style={{
              display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
              padding: "6px 14px", borderRadius: "var(--radius-xl)", border: "none",
              background: "var(--accent-strong)", color: "var(--background)",
              fontSize: "var(--font-size-sm)", fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit", whiteSpace: "nowrap", textDecoration: "none",
            }}
          >
            + New World
          </Link>
        </div>
      </div>,
    );
    return () => setContent(null);
  }, [setContent]);

  return (
    <div style={{ fontFamily: T.fontBody }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: "var(--space-14)", marginBottom: "1.5rem",
        flexWrap: "wrap",
      }}>
        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: "var(--space-10)",
          padding: "0 12px", height: 36, width: 340, borderRadius: "var(--radius-xl)",
          background: "var(--control-bg)",
          border: `1px solid ${T.border}`,
        }}>
          <span style={{ color: T.muted, fontSize: "var(--font-size-lg)" }}>⌕</span>
          <input
            type="text"
            placeholder="Search worlds…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, border: "none", background: "transparent", outline: "none",
              fontSize: "var(--font-size-md)", color: T.fg, fontFamily: T.fontBody,
            }}
          />
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          {filters.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--space-8)",
                  height: 30, padding: f.dot ? "0 12px" : "0 14px",
                  borderRadius: "var(--radius-xl)",
                  border: active ? "1px solid var(--border-active)" : "1px solid transparent",
                  background: active ? "var(--accent-soft)" : "transparent",
                  fontSize: "var(--font-size-base)", fontWeight: active ? 500 : 400,
                  fontFamily: T.fontBody,
                  color: active ? T.accentStrong : "var(--text-tertiary)",
                  cursor: "pointer",
                }}
              >
                {f.dot && (
                  <span style={{
                    width: 6, height: 6, borderRadius: "var(--radius-pill)", background: f.dot, flexShrink: 0,
                  }} />
                )}
                <span>{f.label}</span>
                <span style={{
                  fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", fontWeight: 400,
                  opacity: 0.7,
                }}>
                  {filterCounts[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        {/* Sort */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <span style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", fontWeight: 400,
            letterSpacing: "0.06em", textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}>
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            style={{
              height: 30, padding: "0 10px", borderRadius: "var(--radius-sm)",
              border: `1px solid ${T.border}`, background: "transparent",
              color: "#E8ECF2", fontSize: "var(--font-size-base)", fontFamily: T.fontBody,
              outline: "none", cursor: "pointer",
            }}
          >
            {sorts.map((s) => (
              <option key={s.key} value={s.key} style={{ background: "var(--surface-1)", color: T.fg }}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
        gap: "var(--space-24)",
      }}>
        {filtered.map(({ world, status }) => (
          <WorldCard key={world.id} world={world} status={status} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "4rem 2rem", gap: "var(--space-10)",
        }}>
          <div style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-2xl)", fontWeight: 600, color: T.fg }}>
            No worlds found
          </div>
          <div style={{ fontSize: "var(--font-size-md)", color: T.muted }}>
            {search.trim() ? "Try a different search term." : "Create your first world to get started."}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Refresh button ──────────────────────────────────────── */

function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <style>{`@keyframes worlds-refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-label={pending ? "Refreshing" : "Refresh"}
        title="Refresh"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 26, padding: 0,
          borderRadius: "var(--radius-md)",
          border: `1px solid ${T.border}`,
          background: "rgba(255,255,255,0.05)",
          color: T.muted,
          cursor: pending ? "progress" : "pointer",
          opacity: pending ? 0.75 : 1,
          transition: "color 120ms, border-color 120ms",
        }}
        onMouseEnter={(e) => {
          if (pending) return;
          e.currentTarget.style.color = T.fg;
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = T.muted;
          e.currentTarget.style.borderColor = T.border;
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            animation: pending ? "worlds-refresh-spin 800ms linear infinite" : undefined,
            transformOrigin: "center",
          }}
        >
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </button>
    </>
  );
}

/* ── World Card ──────────────────────────────────────────── */

function WorldCard({ world, status }: { world: WorldDefinition; status: Status }) {
  const gradient = GRADIENTS[hashString(world.id) % GRADIENTS.length];
  const statusStyle = STATUS_STYLES[status];
  const slug = slugFromId(world.id);
  const { tagline, body } = splitSubtitle(world.setting || world.premise || "");
  const descriptionSource = world.premise && world.premise !== tagline ? world.premise : body;

  const stats = [
    { label: "Nodes", value: world.characters.length + world.groups.length + world.roles.length },
    { label: "Characters", value: world.characters.length },
    { label: "Groups", value: world.groups.length },
    { label: "Roles", value: world.roles.length },
    { label: "Events", value: world.eventTemplates.length },
  ];

  const visibleChars = world.characters.slice(0, 3);
  const extraChars = Math.max(0, world.characters.length - visibleChars.length);
  const nameList = world.characters.map((c) => c.name).slice(0, 3).join(", ");
  const nameTrailing = extraChars > 0 ? ` +${extraChars}` : "";

  return (
    <a
      href={`/worlds/${world.id}`}
      style={{
        display: "flex", flexDirection: "column",
        borderRadius: "var(--radius-card, 18px)",
        overflow: "hidden",
        background: "var(--material-card, var(--surface-1))",
        border: `1px solid ${T.border}`,
        boxShadow: "var(--elevation-card)",
        textDecoration: "none", color: "inherit",
        transition: "border-color 150ms, transform 150ms, box-shadow 150ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-active)";
        e.currentTarget.style.boxShadow = "var(--elevation-panel)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = T.border;
        e.currentTarget.style.boxShadow = "var(--elevation-card)";
      }}
    >
      {/* Gradient header */}
      <div style={{
        height: 148, background: gradient, position: "relative",
        padding: "18px 20px", display: "flex", flexDirection: "column",
        justifyContent: "space-between",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
            padding: "3px 10px", borderRadius: "var(--radius-pill)",
            background: "rgba(0,0,0,0.35)",
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 400,
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: statusStyle.color,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "var(--radius-pill)", background: statusStyle.dot,
            }} />
            {statusStyle.label}
          </span>
          <span style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 400,
            letterSpacing: "0.08em", textTransform: "uppercase",
            color: "rgba(255,255,255,0.4)",
          }}>
            {slug}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{
            fontFamily: T.fontHeading, fontSize: 32, fontWeight: 600,
            letterSpacing: "-0.03em", lineHeight: "36px",
            color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {world.title}
          </div>
          {tagline && (
            <div style={{
              fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 400,
              lineHeight: "16px", color: "rgba(143, 209, 203, 0.75)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {tagline}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{
        padding: "18px 20px", display: "flex", flexDirection: "column",
        gap: "var(--space-18)", flex: 1,
      }}>
        <div style={{
          fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 400,
          lineHeight: "20px", color: "var(--text-secondary)",
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {descriptionSource}
        </div>

        {/* Stats */}
        <div style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          gap: "var(--space-12)",
        }}>
          {stats.map((stat) => (
            <div key={stat.label} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div style={{
                fontFamily: T.fontHeading, fontSize: "var(--font-size-4xl)", fontWeight: 300,
                letterSpacing: "-0.02em", lineHeight: "28px",
                color: "var(--text-primary)",
              }}>
                {stat.value}
              </div>
              <div style={{
                fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 400,
                letterSpacing: "0.1em", textTransform: "uppercase",
                color: "var(--text-tertiary)",
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginTop: "auto", paddingTop: "var(--space-14)", borderTop: `1px solid ${T.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", minWidth: 0 }}>
            <div style={{ display: "flex" }}>
              {visibleChars.map((char, i) => {
                const c = avatarColor(char.id);
                return (
                  <span key={char.id} style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 22, height: 22, borderRadius: "var(--radius-pill)",
                    background: c.bg, color: c.fg,
                    fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", fontWeight: 600,
                    border: `2px solid ${T.panel}`,
                    marginLeft: i === 0 ? 0 : -6,
                  }}>
                    {initial(char.name)}
                  </span>
                );
              })}
              {extraChars > 0 && (
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, borderRadius: "var(--radius-pill)",
                  background: "var(--surface-hover)", color: "var(--text-tertiary)",
                  fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
                  border: `2px solid ${T.panel}`,
                  marginLeft: -6,
                }}>
                  +{extraChars}
                </span>
              )}
            </div>
            <span style={{
              fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 400,
              color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", minWidth: 0,
            }}>
              {nameList}{nameTrailing}
            </span>
          </div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "var(--space-4)",
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 400,
            color: T.accentStrong, flexShrink: 0,
          }}>
            Open
            <span style={{ fontSize: "var(--font-size-md)" }}>→</span>
          </span>
        </div>
      </div>
    </a>
  );
}
