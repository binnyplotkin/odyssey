"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useHeaderContent } from "@/components/header-context";

/* ── Types ───────────────────────────────────────────────────── */

type FeatureSummary = {
  id: string;
  title: string;
  status: string;
  color: string;
  ticketCount: number;
  doneTicketCount: number;
};

type VersionSummary = {
  id: string;
  tag: string;
  title: string;
  color: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  featureCount: number;
  features: FeatureSummary[];
  ticketCount: number;
  doneTicketCount: number;
};

type ChangelogEntry = {
  id: string;
  title: string;
  category: string;
  createdAt: string;
};

type DocEntry = {
  id: string;
  title: string;
  updatedAt: string;
};

type Props = {
  versions: VersionSummary[];
  totalFeatures: number;
  totalTickets: number;
  openTickets: number;
  ticketsByStatus: Record<string, number>;
  ticketsByDomain: Record<string, number>;
  ticketsByPriority: Record<string, number>;
  recentChangelog: ChangelogEntry[];
  docs: DocEntry[];
};

/* ── Constants ──────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, { label: string; color: string; bg: string }> = {
  backlog:       { label: "Backlog",     color: "#64748B", bg: "rgba(100, 116, 139, 0.15)" },
  todo:          { label: "To Do",       color: "#3B82F6", bg: "rgba(59, 130, 246, 0.15)" },
  "in-progress": { label: "In Progress", color: "#3B82F6", bg: "rgba(59, 130, 246, 0.15)" },
  review:        { label: "Review",      color: "#F59E0B", bg: "rgba(245, 158, 11, 0.15)" },
  done:          { label: "Done",        color: "#22C55E", bg: "rgba(34, 197, 94, 0.15)" },
};

const DOMAIN_COLORS: Record<string, string> = {
  research: "#8B7EB5", voice: "#C8875A", engine: "#5B7FB5", data: "#C45C5C",
  frontend: "#5B7FB5", world: "#5A9E82", infra: "#8B7EB5", design: "#8B7EB5",
};

const PRIORITY_COLORS: Record<string, { label: string; color: string }> = {
  P1: { label: "P1 Critical", color: "#EF4444" },
  P2: { label: "P2 Medium",   color: "#F59E0B" },
  P3: { label: "P3 Low",      color: "#64748B" },
};

const VERSION_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  planned: { label: "Planned", color: "#64748B", bg: "rgba(100, 116, 139, 0.15)" },
  active:  { label: "Active",  color: "#8CE7D2", bg: "rgba(140, 231, 210, 0.15)" },
  done:    { label: "Done",    color: "#22C55E", bg: "rgba(34, 197, 94, 0.15)" },
};

const CATEGORY_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  feature:     { label: "Feature",     bg: "rgba(96, 165, 250, 0.15)",  color: "#60A5FA" },
  fix:         { label: "Fix",         bg: "rgba(248, 113, 113, 0.15)", color: "#F87171" },
  improvement: { label: "Improvement", bg: "rgba(167, 139, 250, 0.15)", color: "#A78BFA" },
  infra:       { label: "Infra",       bg: "rgba(156, 163, 175, 0.15)", color: "#9CA3AF" },
  breaking:    { label: "Breaking",    bg: "rgba(251, 191, 36, 0.15)",  color: "#FBBF24" },
};

/* ── Helpers ─────────────────────────────────────────────────── */

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

function SectionHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <h2 style={{ fontSize: 11, fontWeight: 600, color: "var(--text-quaternary)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
        {title}
      </h2>
      {href && (
        <Link href={href} style={{ fontSize: 11, color: "#8CE7D2", textDecoration: "none" }}>
          {linkLabel ?? "View all →"}
        </Link>
      )}
    </div>
  );
}

/* ── Component ──────────────────────────────────────────────── */

export default function DashboardClient({
  versions,
  totalFeatures,
  totalTickets,
  openTickets,
  ticketsByStatus,
  ticketsByDomain,
  ticketsByPriority,
  recentChangelog,
  docs,
}: Props) {
  const { setContent } = useHeaderContent();

  useEffect(() => {
    setContent(
      <h1 style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground)", margin: 0 }}>Dashboard</h1>,
    );
    return () => setContent(null);
  }, [setContent]);

  const totalDoneTickets = ticketsByStatus["done"] ?? 0;
  const overallProgress = totalTickets > 0 ? Math.round((totalDoneTickets / totalTickets) * 100) : 0;

  return (
    <div style={{ padding: "24px 28px", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      {/* ── Stat cards ──────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        {[
          { label: "Versions", value: versions.length, detail: `${versions.filter((v) => v.status === "active").length} active` },
          { label: "Features", value: totalFeatures },
          { label: "Tickets", value: totalTickets, detail: `${openTickets} open` },
          { label: "Progress", value: `${overallProgress}%`, detail: `${totalDoneTickets}/${totalTickets} done` },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "var(--card)",
              border: "1px solid var(--card-border)",
              borderRadius: 12,
              padding: "16px 20px",
              minWidth: 150,
              flex: 1,
            }}
          >
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-quaternary)", marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--foreground)" }}>{s.value}</div>
            {s.detail && (
              <div style={{ fontSize: 11, color: "var(--text-quaternary)", marginTop: 2 }}>{s.detail}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── Version progress ────────────────────────────────── */}
      <SectionHeader title="Version Progress" href="/roadmap" linkLabel="Roadmap →" />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
        {versions.map((v) => {
          const pct = v.ticketCount > 0 ? Math.round((v.doneTicketCount / v.ticketCount) * 100) : 0;
          const vs = VERSION_STATUS[v.status] ?? VERSION_STATUS.planned;
          return (
            <div
              key={v.id}
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                background: "var(--card)",
                border: "1px solid var(--card-border)",
              }}
            >
              {/* Version header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{
                  fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono, monospace)",
                  color: v.color, lineHeight: 1,
                }}>
                  {v.tag}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", flex: 1 }}>
                  {v.title}
                </span>
                <span style={{
                  padding: "2px 8px", borderRadius: 9999, fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.04em", textTransform: "uppercase",
                  background: vs.bg, color: vs.color,
                }}>
                  {vs.label}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-quaternary)", fontFamily: "var(--font-mono, monospace)" }}>
                  {pct}%
                </span>
              </div>

              {/* Progress bar */}
              <div style={{ width: "100%", height: 4, borderRadius: 2, background: "var(--card-border)", marginBottom: 12 }}>
                <div style={{
                  width: `${pct}%`, height: 4, borderRadius: 2,
                  background: v.color, transition: "width 0.3s ease",
                }} />
              </div>

              {/* Features row */}
              {v.features.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {v.features.map((f) => {
                    const fPct = f.ticketCount > 0 ? Math.round((f.doneTicketCount / f.ticketCount) * 100) : 0;
                    const fs = VERSION_STATUS[f.status] ?? VERSION_STATUS.planned;
                    return (
                      <div
                        key={f.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "4px 10px", borderRadius: 6,
                          background: "var(--card)",
                          border: "1px solid var(--card-border)",
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: f.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{f.title}</span>
                        {f.ticketCount > 0 && (
                          <span style={{ fontSize: 10, color: "var(--text-quaternary)", fontFamily: "var(--font-mono, monospace)" }}>
                            {f.doneTicketCount}/{f.ticketCount}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {versions.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-quaternary)", padding: "12px 0" }}>
            No versions yet. Create one in the Roadmap.
          </div>
        )}
      </div>

      {/* ── Bottom grid: Tickets + Changes + Docs ────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24, minWidth: 0 }}>
        {/* Ticket breakdown */}
        <div style={{ minWidth: 0 }}>
          <SectionHeader title="Ticket Breakdown" href="/board" linkLabel="Board →" />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* By status */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text-quaternary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                By Status
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(["backlog", "todo", "in-progress", "review", "done"] as const).map((s) => {
                  const count = ticketsByStatus[s] ?? 0;
                  const sc = STATUS_COLORS[s];
                  const barPct = totalTickets > 0 ? (count / totalTickets) * 100 : 0;
                  return (
                    <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 80, fontSize: 11, color: "var(--text-tertiary)" }}>{sc.label}</span>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--input-bg)" }}>
                        <div style={{ width: `${barPct}%`, height: 6, borderRadius: 3, background: sc.color, transition: "width 0.3s" }} />
                      </div>
                      <span style={{ width: 28, textAlign: "right", fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--text-quaternary)" }}>
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By priority */}
            {Object.keys(ticketsByPriority).length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "var(--text-quaternary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  By Priority
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["P1", "P2", "P3"] as const).map((p) => {
                    const count = ticketsByPriority[p] ?? 0;
                    if (count === 0) return null;
                    const pc = PRIORITY_COLORS[p];
                    return (
                      <div
                        key={p}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "6px 12px", borderRadius: 8,
                          background: "var(--card)",
                          border: "1px solid var(--card-border)",
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: pc.color }} />
                        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{pc.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono, monospace)", color: "var(--text-tertiary)" }}>
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* By domain */}
            {Object.keys(ticketsByDomain).length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "var(--text-quaternary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  By Domain
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(ticketsByDomain)
                    .sort((a, b) => b[1] - a[1])
                    .map(([domain, count]) => (
                      <div
                        key={domain}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "4px 10px", borderRadius: 6,
                          background: `${DOMAIN_COLORS[domain] ?? "#8B7EB5"}15`,
                          border: `1px solid ${DOMAIN_COLORS[domain] ?? "#8B7EB5"}25`,
                        }}
                      >
                        <span style={{ fontSize: 10, color: DOMAIN_COLORS[domain] ?? "#8B7EB5" }}>{domain}</span>
                        <span style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", color: "var(--text-quaternary)" }}>{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent changelog */}
        <div style={{ minWidth: 0 }}>
          <SectionHeader title="Recent Changes" href="/changelog" />
          {recentChangelog.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-quaternary)", padding: "12px 0" }}>
              No changelog entries yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {recentChangelog.map((entry) => {
                const cs = CATEGORY_STYLES[entry.category] ?? CATEGORY_STYLES.improvement;
                return (
                  <div
                    key={entry.id}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "var(--card)",
                      border: "1px solid var(--card-border)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{
                      padding: "1px 6px", borderRadius: 9999, fontSize: 9, fontWeight: 600,
                      letterSpacing: "0.04em", textTransform: "uppercase",
                      background: cs.bg, color: cs.color, flexShrink: 0,
                    }}>
                      {cs.label}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
                      {entry.title}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-placeholder)", flexShrink: 0 }}>
                      {timeAgo(entry.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Docs */}
        <div style={{ minWidth: 0 }}>
          <SectionHeader title="Docs" href="/docs" />
          {docs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-quaternary)", padding: "12px 0" }}>
              No docs yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {docs.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/docs/${doc.id}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "var(--card)",
                      border: "1px solid var(--card-border)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--card-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--card)"; }}
                  >
                    <span style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: "rgba(140, 231, 210, 0.08)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, flexShrink: 0, color: "#8CE7D2",
                    }}>
                      ¶
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {doc.title}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-placeholder)" }}>
                        {timeAgo(doc.updatedAt)}
                      </div>
                    </div>
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
