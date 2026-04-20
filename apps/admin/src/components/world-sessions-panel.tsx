import Link from "next/link";
import type { WorldDefinition, SessionRecord } from "@odyssey/types";

const T = {
  fg: "#F1F5F9",
  muted: "#8B96A8",
  dim: "#5A6478",
  panel: "var(--panel)",
  border: "var(--border)",
  accent: "#8FD1CB",
  fontHeading: "'Space Grotesk', system-ui, sans-serif",
  fontBody: "'Inter', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
};

const STATUS_COLORS: Record<SessionRecord["status"], { dot: string; color: string }> = {
  active: { dot: "#7DD3A1", color: "#7DD3A1" },
  paused: { dot: "#F5C67A", color: "#F5C67A" },
  complete: { dot: "#A5B4FC", color: "#A5B4FC" },
};

type Props = {
  world: WorldDefinition;
  sessions: SessionRecord[];
};

export function WorldSessionsPanel({ world, sessions }: Props) {
  const sorted = [...sessions].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

  const activeCount = sessions.filter((s) => s.status === "active").length;
  const completeCount = sessions.filter((s) => s.status === "complete").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, fontFamily: T.fontBody }}>
      <header style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16,
      }}>
        <div>
          <h1 style={{
            fontFamily: T.fontHeading, fontSize: 26, fontWeight: 600,
            letterSpacing: "-0.02em", lineHeight: "32px", margin: 0, color: T.fg,
          }}>
            Sessions
          </h1>
          <p style={{
            fontFamily: T.fontMono, fontSize: 11, fontWeight: 400,
            letterSpacing: "0.08em", textTransform: "uppercase",
            color: T.dim, margin: "6px 0 0",
          }}>
            {sessions.length} total · {activeCount} active · {completeCount} complete
          </p>
        </div>
      </header>

      {/* Stats row */}
      <section style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
      }}>
        <StatCard label="Total" value={sessions.length} />
        <StatCard label="Active" value={activeCount} color="#7DD3A1" />
        <StatCard label="Roles" value={world.roles.length} />
      </section>

      {/* Table */}
      <section style={{
        background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(120px, 1fr) 140px 110px 140px 110px",
          gap: 16,
          padding: "12px 20px",
          background: "rgba(255,255,255,0.02)",
          borderBottom: `1px solid ${T.border}`,
          fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
          letterSpacing: "0.08em", textTransform: "uppercase",
          color: T.dim,
        }}>
          <span>Session</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last active</span>
          <span style={{ textAlign: "right" }}>Version</span>
        </div>

        {sorted.length === 0 ? (
          <EmptyRow />
        ) : (
          sorted.map((session) => {
            const status = STATUS_COLORS[session.status];
            return (
              <div key={session.id} style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 1fr) 140px 110px 140px 110px",
                gap: 16,
                padding: "14px 20px",
                borderBottom: `1px solid ${T.border}`,
                alignItems: "center",
              }}>
                <span style={{
                  fontFamily: T.fontMono, fontSize: 11, color: T.fg,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {session.id}
                </span>
                <span style={{
                  fontFamily: T.fontBody, fontSize: 12, color: T.muted,
                }}>
                  {session.roleId}
                </span>
                <span>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "2px 10px", borderRadius: 9999,
                    background: "rgba(255,255,255,0.04)",
                    fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    color: status.color,
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: 9999, background: status.dot,
                    }} />
                    {session.status}
                  </span>
                </span>
                <span style={{
                  fontFamily: T.fontMono, fontSize: 11, color: T.muted,
                }}>
                  {relativeTime(session.lastActiveAt)}
                </span>
                <span style={{
                  fontFamily: T.fontMono, fontSize: 11, color: T.dim, textAlign: "right",
                }}>
                  v{session.currentStateVersion}
                </span>
              </div>
            );
          })
        )}
      </section>

      <footer>
        <Link
          href="/sessions"
          style={{
            fontFamily: T.fontBody, fontSize: 12, color: T.muted,
            textDecoration: "none",
          }}
        >
          View all sessions →
        </Link>
      </footer>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`,
      borderRadius: 12, padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{
        fontFamily: T.fontHeading, fontSize: 32, fontWeight: 300,
        letterSpacing: "-0.02em", lineHeight: "36px",
        color: color ?? T.fg,
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
        letterSpacing: "0.1em", textTransform: "uppercase",
        color: T.dim,
      }}>
        {label}
      </div>
    </div>
  );
}

function EmptyRow() {
  return (
    <div style={{
      padding: "40px 24px", textAlign: "center",
      fontFamily: T.fontBody, fontSize: 13, color: T.muted,
    }}>
      No sessions for this world yet.
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  if (diffMon < 12) return `${diffMon}mo ago`;
  return `${Math.floor(diffMon / 12)}y ago`;
}
