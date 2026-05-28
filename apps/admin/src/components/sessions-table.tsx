"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useHeaderContent } from "@/components/header-context";

export type SessionRow = {
  id: string;
  userId?: string | null;
  user?: {
    id: string;
    name?: string | null;
    email: string;
    image?: string | null;
  } | null;
  worldId?: string | null;
  characterId?: string | null;
  mode: string;
  status: string;
  contextBuildCount: number;
  turnCount: number;
  eventCount: number;
  startedAt: string;
  endedAt?: string | null;
  lastActiveAt: string;
};

type Props = {
  sessions: SessionRow[];
};

const T = {
  fg: "var(--foreground)",
  muted: "var(--text-tertiary)",
  panel: "var(--surface-1)",
  border: "var(--border)",
  accent: "var(--accent)",
  accentStrong: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  cardHover: "var(--surface-hover)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
} as const;

type ModeValue = "voice" | "chat" | "mixed" | "simulation";
type StatusValue = "active" | "ended" | "error";
type ActivityValue = "live" | "today" | "older";

type Filters = {
  mode?: ModeValue;
  status?: StatusValue;
  activity?: ActivityValue;
};

type FilterKey = keyof Filters;

const FILTER_PILLS: {
  key: FilterKey;
  label: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "mode",
    label: "Mode",
    options: [
      { value: "voice", label: "Voice" },
      { value: "chat", label: "Chat" },
      { value: "mixed", label: "Mixed" },
      { value: "simulation", label: "Simulation" },
    ],
  },
  {
    key: "status",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "ended", label: "Ended" },
      { value: "error", label: "Error" },
    ],
  },
  {
    key: "activity",
    label: "Activity",
    options: [
      { value: "live", label: "Last 5 min" },
      { value: "today", label: "Last 24h" },
      { value: "older", label: "Older" },
    ],
  },
];

type SortBy = "lastActive" | "started" | "turns" | "events" | "context";

const SORTS: { key: SortBy; label: string }[] = [
  { key: "lastActive", label: "Last active" },
  { key: "started", label: "Started" },
  { key: "turns", label: "Turns" },
  { key: "events", label: "Events" },
  { key: "context", label: "Context" },
];

function shortId(id: string | null | undefined) {
  if (!id) return "none";
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function titleCase(value: string) {
  if (!value) return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function userLabel(session: SessionRow) {
  return session.user?.name?.trim() || session.user?.email || shortId(session.userId);
}

function userSubLabel(session: SessionRow) {
  if (session.user?.name?.trim() && session.user.email) return session.user.email;
  return session.userId ? shortId(session.userId) : "none";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(iso: string | null | undefined): { label: string; dotColor: string | null } {
  if (!iso) return { label: "Never", dotColor: null };
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);

  if (mins < 2) return { label: "Active now", dotColor: "var(--status-live)" };
  if (mins < 60) return { label: `${mins}m ago`, dotColor: "var(--status-live)" };

  const hours = Math.floor(mins / 60);
  if (hours < 24) return { label: `${hours}h ago`, dotColor: "var(--status-draft)" };

  const days = Math.floor(hours / 24);
  if (days < 7) return { label: `${days}d ago`, dotColor: "var(--text-tertiary)" };

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return { label: `${weeks}w ago`, dotColor: "var(--text-tertiary)" };

  const months = Math.floor(days / 30);
  if (months < 12) return { label: `${months}mo ago`, dotColor: "var(--text-tertiary)" };

  return { label: `${Math.floor(days / 365)}y ago`, dotColor: "var(--text-tertiary)" };
}

function activityOf(session: SessionRow): ActivityValue {
  const ageMs = Date.now() - new Date(session.lastActiveAt).getTime();
  if (ageMs < 5 * 60 * 1000) return "live";
  if (ageMs < 24 * 60 * 60 * 1000) return "today";
  return "older";
}

function statusFilterValue(status: string): StatusValue | "other" {
  if (status === "active" || status === "ended" || status === "error") return status;
  if (status === "complete") return "ended";
  return "other";
}

function modeFilterValue(mode: string): ModeValue | "other" {
  if (mode === "voice" || mode === "chat" || mode === "mixed" || mode === "simulation") return mode;
  return "other";
}

function csvCell(value: string | number | null | undefined) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replaceAll("\"", "\"\"")}"`;
}

export function SessionsTable({ sessions }: Props) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [sortBy, setSortBy] = useState<SortBy>("lastActive");
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  const toggleFilter = useCallback((key: FilterKey, value: string) => {
    setFilters((prev) => {
      if (prev[key] === value) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value as never };
    });
    setOpenFilter(null);
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({});
    setSearch("");
  }, []);

  useEffect(() => {
    if (!openFilter) return;
    const handler = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openFilter]);

  const counts = useMemo(() => {
    let active = 0;
    let totalTurns = 0;
    let totalEvents = 0;
    for (const session of sessions) {
      if (statusFilterValue(session.status) === "active") active++;
      totalTurns += session.turnCount;
      totalEvents += session.eventCount;
    }
    return { active, totalTurns, totalEvents };
  }, [sessions]);

  const filtered = useMemo(() => {
    let result = sessions;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((session) =>
        session.id.toLowerCase().includes(q) ||
        (session.userId ?? "").toLowerCase().includes(q) ||
        (session.user?.name ?? "").toLowerCase().includes(q) ||
        (session.user?.email ?? "").toLowerCase().includes(q) ||
        (session.characterId ?? "").toLowerCase().includes(q) ||
        (session.worldId ?? "").toLowerCase().includes(q) ||
        session.mode.toLowerCase().includes(q) ||
        session.status.toLowerCase().includes(q),
      );
    }

    if (filters.mode) result = result.filter((session) => modeFilterValue(session.mode) === filters.mode);
    if (filters.status) result = result.filter((session) => statusFilterValue(session.status) === filters.status);
    if (filters.activity) result = result.filter((session) => activityOf(session) === filters.activity);

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "started":
          return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
        case "turns":
          return b.turnCount - a.turnCount;
        case "events":
          return b.eventCount - a.eventCount;
        case "context":
          return b.contextBuildCount - a.contextBuildCount;
        case "lastActive":
        default:
          return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
      }
    });

    return result;
  }, [sessions, search, filters, sortBy]);

  const exportCsv = useCallback(() => {
    const rows = [
      ["id", "mode", "status", "character_id", "world_id", "context_builds", "turns", "events", "started_at", "last_active_at", "ended_at"],
      ...filtered.map((session) => [
        session.id,
        session.mode,
        session.status,
        session.characterId ?? "",
        session.worldId ?? "",
        session.contextBuildCount,
        session.turnCount,
        session.eventCount,
        session.startedAt,
        session.lastActiveAt,
        session.endedAt ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `world-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const { setContent } = useHeaderContent();
  const toggleFilterRef = useRef(toggleFilter);
  const setOpenFilterRef = useRef(setOpenFilter);
  const clearAllFiltersRef = useRef(clearAllFilters);
  toggleFilterRef.current = toggleFilter;
  setOpenFilterRef.current = setOpenFilter;
  clearAllFiltersRef.current = clearAllFilters;

  useEffect(() => {
    setContent(
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          gap: "var(--space-12)",
          minWidth: 0,
        }}
      >
        <h1
          style={{
            fontSize: "var(--font-size-xl)",
            fontWeight: 700,
            color: "var(--foreground)",
            marginTop: 0,
            marginRight: 0,
            marginBottom: 0,
            marginLeft: 0,
            whiteSpace: "nowrap",
            fontFamily: T.fontHeading,
          }}
        >
          Sessions
        </h1>

        <div ref={filterRef} className="admin-table-header-filters" style={{ display: "flex", gap: "var(--space-6)", whiteSpace: "nowrap" }}>
          {FILTER_PILLS.map((pill) => {
            const activeValue = filters[pill.key];
            const isActive = !!activeValue;
            const isOpen = openFilter === pill.key;
            const activeLabel = isActive
              ? pill.options.find((option) => option.value === activeValue)?.label ?? activeValue
              : null;
            return (
              <div key={pill.key} style={{ position: "relative" }}>
                <button
                  className="odyssey-filter-pill"
                  data-active={isActive}
                  type="button"
                  onClick={() => setOpenFilterRef.current(isOpen ? null : pill.key)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "var(--radius-md)",
                    border: `1px solid ${isActive ? "var(--border-active)" : "var(--border)"}`,
                    background: isActive ? "var(--accent-soft)" : "transparent",
                    color: isActive ? "var(--accent-strong)" : "var(--text-tertiary)",
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {pill.label}
                  {isActive && <span style={{ marginLeft: "var(--space-4)", opacity: 0.7 }}>{activeLabel}</span>}
                </button>
                {isOpen && (
                  <FilterDropdown
                    options={pill.options}
                    active={activeValue}
                    onSelect={(value) => toggleFilterRef.current(pill.key, value)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <button
          className="odyssey-icon-button"
          type="button"
          onClick={() => clearAllFiltersRef.current()}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-tertiary)",
            cursor: "pointer",
          }}
          title="Reset filters"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 0 1 15.5-6.2" />
            <path d="M18.5 3.5V8h-4.5" />
            <path d="M21 12a9 9 0 0 1-15.5 6.2" />
            <path d="M5.5 20.5V16H10" />
          </svg>
        </button>
      </div>,
    );
    return () => setContent(null);
  }, [filters, openFilter, setContent]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)" }}>
      <div className="admin-table-toolbar odyssey-toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-16)", flexWrap: "wrap" }}>
        <div className="admin-table-toolbar-primary" style={{ display: "flex", alignItems: "center", gap: "var(--space-16)" }}>
          <div className="admin-table-search odyssey-search" style={{
            display: "flex", alignItems: "center", gap: "var(--space-8)",
            padding: "0.5rem 0.75rem", borderRadius: "var(--radius-lg)",
            background: T.panel, border: `1px solid ${T.border}`,
            width: 360,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="6" cy="6" r="4.5" stroke="var(--text-tertiary)" strokeWidth="1.5" />
              <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search by session, character, world..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{
                flex: 1, border: "none", background: "transparent", outline: "none",
                fontSize: "0.8125rem", color: T.fg, fontFamily: T.fontBody,
              }}
            />
          </div>
          <span style={{
            fontFamily: T.fontMono, fontSize: "0.6875rem", fontWeight: 500,
            color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            {filtered.length} {filtered.length === 1 ? "session" : "sessions"} - {counts.active} active - {counts.totalTurns} turns
          </span>
        </div>

        <div className="admin-table-toolbar-actions" style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <div className="odyssey-select-shell" style={{
            display: "flex", alignItems: "center", gap: "var(--space-6)",
            padding: "0.4rem 0.75rem", borderRadius: "var(--radius-button, 12px)",
            border: `1px solid ${T.border}`,
            fontSize: "0.75rem", color: T.muted, fontFamily: T.fontBody,
          }}>
            <span>Sort</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortBy)}
              style={{
                border: "none", background: "transparent", outline: "none",
                color: T.fg, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", fontFamily: T.fontBody,
              }}
            >
              {SORTS.map((sort) => (
                <option key={sort.key} value={sort.key} style={{ background: "var(--background)", color: T.fg }}>
                  {sort.label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="odyssey-ghost-button"
            type="button"
            onClick={exportCsv}
            style={{
              display: "flex", alignItems: "center", gap: "var(--space-6)",
              padding: "0.4rem 0.75rem", borderRadius: "var(--radius-button, 12px)",
              border: `1px solid ${T.border}`, background: "transparent",
              color: T.muted, fontSize: "0.75rem", cursor: "pointer",
              fontFamily: T.fontBody,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      <div className="admin-table-scroll">
        <div className="admin-table-grid" style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 1340,
          background: T.panel,
          border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-2xl)",
          overflow: "hidden",
        }}>
          <HeaderRow />
          {filtered.map((session) => (
            <SessionDataRow key={session.id} session={session} />
          ))}
          {filtered.length === 0 && (
            <div style={{
              padding: "3rem 1rem", textAlign: "center",
              color: T.muted, fontSize: "0.8125rem", fontFamily: T.fontBody,
            }}>
              {sessions.length === 0
                ? "No sessions yet. Start a voice session from a character page to populate this view."
                : "No sessions match your filters."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterDropdown({
  options,
  active,
  onSelect,
}: {
  options: { value: string; label: string }[];
  active: string | undefined;
  onSelect: (value: string) => void;
}) {
  return (
    <div
      className="odyssey-dropdown"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        minWidth: 160,
        background: "var(--popover-bg, var(--surface-1))",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "4px 0",
        zIndex: 100,
        boxShadow: "var(--elevation-card)",
      }}
    >
      {options.map((option) => (
        <button
          className="odyssey-dropdown-item"
          data-active={active === option.value}
          key={option.value}
          type="button"
          onClick={() => onSelect(option.value)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
            width: "100%",
            padding: "6px 12px",
            background: active === option.value ? "var(--accent-soft)" : "none",
            border: "none",
            cursor: "pointer",
            color: active === option.value ? "var(--accent-strong)" : "var(--text-tertiary)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            textAlign: "left",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function HeaderRow() {
  const headerStyle = {
    fontFamily: T.fontMono,
    fontSize: "0.6875rem",
    fontWeight: 500,
    color: T.muted,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    flexShrink: 0,
  };

  return (
    <div className="admin-table-header-row" style={{
      display: "flex", alignItems: "center", gap: "var(--space-20)",
      padding: "12px 20px",
      borderBottom: `1px solid ${T.border}`,
      background: T.cardHover,
    }}>
      <div className="admin-table-row-check" style={{ width: 20, height: 20, flexShrink: 0, border: `1.25px solid ${T.border}`, borderRadius: "var(--radius-xs)" }} />
      <span style={{ ...headerStyle, flex: 1, minWidth: 0 }}>Session</span>
      <span style={{ ...headerStyle, width: 100 }}>Mode</span>
      <span style={{ ...headerStyle, width: 110 }}>Status</span>
      <span style={{ ...headerStyle, width: 170 }}>User</span>
      <span style={{ ...headerStyle, width: 130 }}>Character</span>
      <span style={{ ...headerStyle, width: 80, textAlign: "right" }}>Context</span>
      <span style={{ ...headerStyle, width: 70, textAlign: "right" }}>Turns</span>
      <span style={{ ...headerStyle, width: 80, textAlign: "right" }}>Events</span>
      <span style={{ ...headerStyle, width: 130 }}>Last active</span>
      <span style={{ ...headerStyle, width: 110 }}>Started</span>
    </div>
  );
}

function SessionDataRow({ session }: { session: SessionRow }) {
  const active = formatRelative(session.lastActiveAt);

  return (
    <Link
      className="admin-table-data-row"
      href={`/sessions/${session.id}`}
      style={{
        display: "flex", alignItems: "center", gap: "var(--space-20)",
        padding: "14px 20px",
        borderBottom: `1px solid ${T.border}`,
        transition: "background 100ms",
        color: "inherit",
        textDecoration: "none",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.background = T.cardHover; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
    >
      <div className="admin-table-row-check" style={{ width: 20, height: 20, flexShrink: 0, border: `1.25px solid ${T.border}`, borderRadius: "var(--radius-xs)" }} />

      <div className="admin-table-primary-cell" style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", flex: 1, minWidth: 0 }}>
        <SessionIcon mode={session.mode} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", minWidth: 0 }}>
            <span style={{
              fontFamily: T.fontHeading,
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "var(--foreground)",
              lineHeight: "18px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {shortId(session.id)}
            </span>
            {session.status === "active" && (
              <span style={{
                fontFamily: T.fontMono,
                fontSize: "0.5625rem",
                fontWeight: 600,
                color: T.accentStrong,
                background: T.accentSoft,
                padding: "2px 6px",
                borderRadius: "var(--radius-xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}>
                Live
              </span>
            )}
          </div>
          <span style={{
            fontFamily: T.fontBody,
            fontSize: "0.75rem",
            color: T.muted,
            lineHeight: "15px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            world {shortId(session.worldId)} - user {shortId(session.userId)}
          </span>
        </div>
      </div>

      <div className="admin-table-mobile-fields">
        <MobileField label="Mode"><ModeBadge mode={session.mode} /></MobileField>
        <MobileField label="Status"><StatusBadge status={session.status} /></MobileField>
        <MobileField label="User">{userLabel(session)}</MobileField>
        <MobileField label="Character">{shortId(session.characterId)}</MobileField>
        <MobileField label="Context">{session.contextBuildCount}</MobileField>
        <MobileField label="Turns">{session.turnCount}</MobileField>
        <MobileField label="Events">{session.eventCount}</MobileField>
        <MobileField label="Last active">
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
            {active.dotColor && (
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: active.dotColor, display: "block" }} />
            )}
            {active.label}
          </span>
        </MobileField>
        <MobileField label="Started">{formatDate(session.startedAt)}</MobileField>
      </div>

      <div className="admin-table-desktop-cell" style={{ width: 100, flexShrink: 0 }}>
        <ModeBadge mode={session.mode} />
      </div>

      <div className="admin-table-desktop-cell" style={{ width: 110, flexShrink: 0 }}>
        <StatusBadge status={session.status} />
      </div>

      <div className="admin-table-desktop-cell" style={{ width: 170, flexShrink: 0, minWidth: 0 }}>
        <div style={{
          fontFamily: T.fontBody,
          fontSize: "0.75rem",
          color: session.user || session.userId ? "var(--foreground)" : T.muted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {userLabel(session)}
        </div>
        <div style={{
          marginTop: "var(--space-2)",
          fontFamily: T.fontMono,
          fontSize: "0.625rem",
          color: T.muted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {userSubLabel(session)}
        </div>
      </div>

      <span className="admin-table-desktop-cell" style={{
        width: 130,
        flexShrink: 0,
        fontFamily: T.fontMono,
        fontSize: "0.75rem",
        color: session.characterId ? "var(--foreground)" : T.muted,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {shortId(session.characterId)}
      </span>

      <MetricCell className="admin-table-desktop-cell" value={session.contextBuildCount} width={80} mutedWhenZero />
      <MetricCell className="admin-table-desktop-cell" value={session.turnCount} width={70} mutedWhenZero />
      <MetricCell className="admin-table-desktop-cell" value={session.eventCount} width={80} mutedWhenZero />

      <div className="admin-table-desktop-cell" style={{ width: 130, flexShrink: 0, display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        {active.dotColor && (
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: active.dotColor, display: "block" }} />
        )}
        <span style={{ fontFamily: T.fontBody, fontSize: "0.75rem", color: "var(--foreground)" }}>
          {active.label}
        </span>
      </div>

      <span className="admin-table-desktop-cell" style={{
        width: 110,
        flexShrink: 0,
        fontFamily: T.fontBody,
        fontSize: "0.75rem",
        color: T.muted,
      }}>
        {formatDate(session.startedAt)}
      </span>
    </Link>
  );
}

function MobileField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-table-mobile-field">
      <span className="admin-table-mobile-label">{label}</span>
      <span className="admin-table-mobile-value">{children}</span>
    </div>
  );
}

function SessionIcon({ mode }: { mode: string }) {
  const colors = mode === "voice"
    ? { bg: "color-mix(in srgb, var(--accent-strong) 14%, transparent)", fg: "var(--accent-strong)" }
    : mode === "chat"
      ? { bg: "color-mix(in srgb, var(--signal-blue) 14%, transparent)", fg: "var(--signal-blue)" }
      : mode === "simulation"
        ? { bg: "color-mix(in srgb, var(--event-violet) 14%, transparent)", fg: "var(--event-violet)" }
        : { bg: "color-mix(in srgb, var(--status-archived) 14%, transparent)", fg: "var(--status-archived)" };

  return (
    <div style={{
      width: 36,
      height: 36,
      flexShrink: 0,
      borderRadius: "50%",
      background: colors.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <span style={{
        fontFamily: T.fontHeading,
        fontSize: "0.875rem",
        fontWeight: 600,
        color: colors.fg,
        lineHeight: "16px",
      }}>
        {mode.charAt(0).toUpperCase() || "S"}
      </span>
    </div>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-6)",
      padding: "4px 10px",
      background: T.cardHover,
      borderRadius: "var(--radius-button, 12px)",
      fontFamily: T.fontMono,
      fontSize: "0.625rem",
      fontWeight: 600,
      color: T.muted,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}>
      {titleCase(mode)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = statusFilterValue(status);
  const color = normalized === "active"
    ? "var(--accent-strong)"
    : normalized === "error"
      ? "var(--status-error)"
      : "var(--status-live)";

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-6)",
      padding: "4px 10px",
      background: normalized === "active" ? T.accentSoft : T.cardHover,
      borderRadius: "var(--radius-button, 12px)",
      fontFamily: T.fontMono,
      fontSize: "0.625rem",
      fontWeight: 600,
      color,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "block" }} />
      {titleCase(status)}
    </span>
  );
}

function MetricCell({
  value,
  width,
  mutedWhenZero,
  className,
}: {
  value: number;
  width: number;
  mutedWhenZero?: boolean;
  className?: string;
}) {
  return (
    <span className={className} style={{
      width,
      flexShrink: 0,
      textAlign: "right",
      fontFamily: T.fontMono,
      fontSize: "0.8125rem",
      fontWeight: 500,
      color: mutedWhenZero && value === 0 ? T.muted : "var(--foreground)",
    }}>
      {value}
    </span>
  );
}
