"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useHeaderContent } from "@/components/header-context";
import { StatCard } from "@/components/stat-card";

/* ── Types ───────────────────────────────────────────────────── */

type ChangelogEntry = {
  id: string;
  versionId: string | null;
  title: string;
  body: string | null;
  category: string;
  commitSha: string | null;
  prNumber: number | null;
  prTitle: string | null;
  branch: string | null;
  author: string | null;
  diffSummary: string | null;
  createdAt: string;
};

type PlatformVersion = {
  id: string;
  version: string;
  title: string;
  summary: string | null;
  status: string;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Session = {
  id: string;
  worldId: string;
  status: string;
  currentStateVersion: number;
  lastActiveAt: string;
};

type Props = {
  stats: {
    worlds: number;
    sessions: number;
    activeSessions: number;
    tickets: number;
    openTickets: number;
    versions: number;
  };
  activeVersion: PlatformVersion | null;
  recentChangelog: ChangelogEntry[];
  recentSessions: Session[];
  changelogTotal: number;
};

/* ── Category styling ────────────────────────────────────────── */

const CATEGORY_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  feature:     { label: "Feature",     bg: "rgba(96, 165, 250, 0.15)",  color: "#60A5FA" },
  fix:         { label: "Fix",         bg: "rgba(248, 113, 113, 0.15)", color: "#F87171" },
  improvement: { label: "Improvement", bg: "rgba(167, 139, 250, 0.15)", color: "#A78BFA" },
  infra:       { label: "Infra",       bg: "rgba(156, 163, 175, 0.15)", color: "#9CA3AF" },
  breaking:    { label: "Breaking",    bg: "rgba(251, 191, 36, 0.15)",  color: "#FBBF24" },
};

function categoryBadge(category: string) {
  const s = CATEGORY_STYLES[category] ?? CATEGORY_STYLES.improvement;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.12rem 0.5rem",
        borderRadius: 9999,
        fontSize: "0.6rem",
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    released: { label: "Released", bg: "rgba(140, 231, 210, 0.15)", color: "#8CE7D2" },
    active:   { label: "Active",   bg: "rgba(143, 209, 203, 0.15)", color: "#8fd1cb" },
    draft:    { label: "Draft",    bg: "rgba(255, 255, 255, 0.06)", color: "rgba(255,255,255,0.5)" },
  };
  const s = map[status] ?? map.draft;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.6rem",
        borderRadius: 9999,
        fontSize: "0.65rem",
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Section header ──────────────────────────────────────────── */

function SectionHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
      <h2 style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--muted, rgba(255,255,255,0.5))", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
        {title}
      </h2>
      {href && (
        <Link href={href} style={{ fontSize: "0.75rem", color: "var(--accent, #8fd1cb)", textDecoration: "none" }}>
          {linkLabel ?? "View all"}
        </Link>
      )}
    </div>
  );
}

/* ── Component ───────────────────────────────────────────────── */

export default function DashboardClient({ stats, activeVersion, recentChangelog, recentSessions, changelogTotal }: Props) {
  const { setContent } = useHeaderContent();

  useEffect(() => {
    setContent(
      <h1 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Dashboard</h1>,
    );
  }, [setContent]);

  return (
    <div style={{ padding: "1.5rem 2rem", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      {/* ── Stat cards ──────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <StatCard label="Worlds" value={stats.worlds} />
        <StatCard label="Sessions" value={stats.sessions} detail={`${stats.activeSessions} active`} />
        <StatCard label="Tickets" value={stats.tickets} detail={`${stats.openTickets} open`} />
        <StatCard label="Versions" value={stats.versions} />
      </div>

      {/* ── Active version banner ───────────────────────────────── */}
      {activeVersion && (
        <div
          style={{
            padding: "1rem 1.25rem",
            borderRadius: 12,
            background: "rgba(143, 209, 203, 0.06)",
            border: "1px solid rgba(143, 209, 203, 0.15)",
            marginBottom: "1.5rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--accent, #8fd1cb)",
              fontFamily: "var(--font-mono, monospace)",
              lineHeight: 1,
            }}
          >
            {activeVersion.version}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{activeVersion.title}</span>
              {statusBadge(activeVersion.status)}
            </div>
            {activeVersion.summary && (
              <div style={{ fontSize: "0.78rem", color: "var(--muted, rgba(255,255,255,0.5))", lineHeight: 1.4 }}>
                {activeVersion.summary}
              </div>
            )}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: "0.7rem", color: "var(--muted, rgba(255,255,255,0.4))" }}>
              {changelogTotal} changelog {changelogTotal === 1 ? "entry" : "entries"}
            </div>
            {activeVersion.releasedAt && (
              <div style={{ fontSize: "0.7rem", color: "var(--muted, rgba(255,255,255,0.4))", marginTop: "0.15rem" }}>
                Released {new Date(activeVersion.releasedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Two-column layout ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", minWidth: 0 }}>
        {/* Recent changelog */}
        <div style={{ minWidth: 0 }}>
          <SectionHeader title="Recent Changes" href="/changelog" />
          {recentChangelog.length === 0 ? (
            <div style={{ fontSize: "0.8rem", color: "var(--muted, rgba(255,255,255,0.4))", padding: "1rem 0" }}>
              No changelog entries yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {recentChangelog.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    padding: "0.6rem 0.75rem",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    {categoryBadge(entry.category)}
                    <span style={{ fontSize: "0.8rem", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.title}
                    </span>
                    <span style={{ fontSize: "0.65rem", color: "var(--muted, rgba(255,255,255,0.35))", flexShrink: 0 }}>
                      {timeAgo(entry.createdAt)}
                    </span>
                  </div>
                  {entry.body && (
                    <div style={{ fontSize: "0.72rem", color: "var(--muted, rgba(255,255,255,0.45))", marginTop: "0.25rem", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.body}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent sessions */}
        <div style={{ minWidth: 0 }}>
          <SectionHeader title="Recent Sessions" href="/sessions" />
          {recentSessions.length === 0 ? (
            <div style={{ fontSize: "0.8rem", color: "var(--muted, rgba(255,255,255,0.4))", padding: "1rem 0" }}>
              No sessions yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {recentSessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/sessions/${session.id}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div
                    style={{
                      padding: "0.6rem 0.75rem",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: session.status === "active"
                          ? "var(--accent, #8fd1cb)"
                          : session.status === "complete"
                            ? "rgba(140, 231, 210, 0.5)"
                            : "rgba(255,255,255,0.2)",
                        boxShadow: session.status === "active" ? "0 0 6px var(--accent, #8fd1cb)" : "none",
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {session.worldId}
                      </div>
                      <div style={{ fontSize: "0.68rem", color: "var(--muted, rgba(255,255,255,0.4))" }}>
                        {session.currentStateVersion} turns
                      </div>
                    </div>
                    <span style={{ fontSize: "0.65rem", color: "var(--muted, rgba(255,255,255,0.35))", flexShrink: 0 }}>
                      {timeAgo(session.lastActiveAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
