"use client";

import { useState, useMemo, useEffect } from "react";
import { useHeaderContent } from "@/components/header-context";

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

type Props = {
  entries: ChangelogEntry[];
  versions: PlatformVersion[];
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
        padding: "0.15rem 0.55rem",
        borderRadius: "var(--radius-pill)",
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

/* ── Author avatar ───────────────────────────────────────────── */

function AuthorAvatar({ login, size = 18 }: { login: string; size?: number }) {
  const [errored, setErrored] = useState(false);
  const initial = login.slice(0, 1).toUpperCase();
  if (errored) {
    return (
      <span
        title={login}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "rgba(139, 126, 181, 0.20)",
          color: "#8B7EB5",
          fontSize: Math.round(size * 0.5),
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {initial}
      </span>
    );
  }
  return (
    <img
      src={`https://github.com/${encodeURIComponent(login)}.png?size=${size * 2}`}
      alt={login}
      title={login}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-block",
        flexShrink: 0,
        objectFit: "cover",
      }}
    />
  );
}

/* ── Date formatting ─────────────────────────────────────────── */

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* ── Component ───────────────────────────────────────────────── */

type FilterCategory = "all" | "feature" | "fix" | "improvement" | "infra" | "breaking";

export default function ChangelogClient({ entries: initialEntries, versions }: Props) {
  const [entries] = useState(initialEntries);
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
  const [filterVersion, setFilterVersion] = useState<string>("all");
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  /* header */
  const { setContent } = useHeaderContent();
  useEffect(() => {
    setContent(
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Changelog</h1>
        <span style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>
          {entries.length} entries
        </span>
      </div>,
    );
  }, [entries.length, setContent]);

  /* version lookup */
  const versionMap = useMemo(() => {
    const map = new Map<string, PlatformVersion>();
    for (const v of versions) map.set(v.id, v);
    return map;
  }, [versions]);

  /* filtered entries */
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterCategory !== "all" && e.category !== filterCategory) return false;
      if (filterVersion !== "all" && e.versionId !== filterVersion) return false;
      return true;
    });
  }, [entries, filterCategory, filterVersion]);

  /* group entries by date */
  const grouped = useMemo(() => {
    const groups: { date: string; entries: ChangelogEntry[] }[] = [];
    let currentDate = "";
    for (const entry of filtered) {
      const date = formatDate(entry.createdAt);
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, entries: [] });
      }
      groups[groups.length - 1].entries.push(entry);
    }
    return groups;
  }, [filtered]);

  /* category filter pills */
  const categories: FilterCategory[] = ["all", "feature", "fix", "improvement", "infra", "breaking"];

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: 900, margin: "0 auto" }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem", alignItems: "center" }}>
        {/* Category pills */}
        {categories.map((cat) => {
          const active = filterCategory === cat;
          const style = cat === "all" ? null : CATEGORY_STYLES[cat];
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              style={{
                padding: "0.35rem 0.75rem",
                borderRadius: "var(--radius-pill)",
                fontSize: "0.75rem",
                fontWeight: 600,
                border: "1px solid",
                borderColor: active
                  ? (style?.color ?? "var(--accent, #8fd1cb)")
                  : "var(--border-subtle)",
                background: active
                  ? (style?.bg ?? "rgba(143, 209, 203, 0.15)")
                  : "transparent",
                color: active
                  ? (style?.color ?? "var(--accent, #8fd1cb)")
                  : "var(--text-tertiary)",
                cursor: "pointer",
                textTransform: "capitalize",
                transition: "all 0.15s",
              }}
            >
              {cat}
            </button>
          );
        })}

        {/* Version filter */}
        {versions.length > 0 && (
          <select
            value={filterVersion}
            onChange={(e) => setFilterVersion(e.target.value)}
            style={{
              marginLeft: "auto",
              padding: "0.35rem 0.6rem",
              borderRadius: "var(--radius-md)",
              fontSize: "0.75rem",
              background: "var(--control-bg)",
              color: "var(--text-primary)",
              border: "1px solid var(--control-border)",
              cursor: "pointer",
            }}
          >
            <option value="all">All versions</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.version} — {v.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Timeline */}
      {grouped.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "4rem 2rem",
            color: "var(--text-quaternary)",
            fontSize: "0.9rem",
          }}
        >
          No changelog entries yet. Entries are created automatically on push to main.
        </div>
      )}

      {grouped.map((group) => (
        <div key={group.date} style={{ marginBottom: "2rem" }}>
          {/* Date header */}
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: "0.75rem",
              paddingBottom: "0.5rem",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            {group.date}
          </div>

          {/* Entries */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {group.entries.map((entry) => {
              const expanded = expandedEntry === entry.id;
              const version = entry.versionId ? versionMap.get(entry.versionId) : null;

              return (
                <div
                  key={entry.id}
                  onClick={() => setExpandedEntry(expanded ? null : entry.id)}
                  style={{
                    padding: "0.75rem 1rem",
                    borderRadius: "var(--radius-lg)",
                    background: expanded ? "var(--surface-hover)" : "var(--material-card)",
                    border: "1px solid",
                    borderColor: expanded ? "var(--border-subtle)" : "var(--border-subtle)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {/* Top row */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    {categoryBadge(entry.category)}
                    <span style={{ fontSize: "0.85rem", fontWeight: 500, flex: 1 }}>
                      {entry.title}
                    </span>
                    {entry.author && <AuthorAvatar login={entry.author} size={18} />}
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--text-quaternary)",
                        flexShrink: 0,
                      }}
                    >
                      {formatTime(entry.createdAt)}
                    </span>
                  </div>

                  {/* Body (if present) */}
                  {entry.body && (
                    <div
                      style={{
                        marginTop: "0.4rem",
                        fontSize: "0.8rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.5,
                      }}
                    >
                      {entry.body}
                    </div>
                  )}

                  {/* Expanded details */}
                  {expanded && (
                    <div
                      style={{
                        marginTop: "0.75rem",
                        paddingTop: "0.75rem",
                        borderTop: "1px solid var(--border-subtle)",
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "0.3rem 1rem",
                        fontSize: "0.75rem",
                      }}
                    >
                      {entry.commitSha && (
                        <>
                          <span style={{ color: "var(--text-quaternary)" }}>Commit</span>
                          <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>
                            {entry.commitSha.slice(0, 7)}
                          </span>
                        </>
                      )}
                      {entry.prNumber && (
                        <>
                          <span style={{ color: "var(--text-quaternary)" }}>PR</span>
                          <span>#{entry.prNumber}{entry.prTitle ? ` — ${entry.prTitle}` : ""}</span>
                        </>
                      )}
                      {entry.branch && (
                        <>
                          <span style={{ color: "var(--text-quaternary)" }}>Branch</span>
                          <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{entry.branch}</span>
                        </>
                      )}
                      {entry.author && (
                        <>
                          <span style={{ color: "var(--text-quaternary)" }}>Author</span>
                          <span>{entry.author}</span>
                        </>
                      )}
                      {version && (
                        <>
                          <span style={{ color: "var(--text-quaternary)" }}>Version</span>
                          <span>{version.version} — {version.title}</span>
                        </>
                      )}
                      {entry.diffSummary && (
                        <>
                          <span style={{ color: "var(--text-quaternary)" }}>Changes</span>
                          <span>{entry.diffSummary}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
