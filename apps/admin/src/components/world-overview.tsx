import type { WorldDetail } from "@odyssey/db";

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

const GRADIENT = "linear-gradient(135deg, #1a4440 0%, #102a28 55%, #0a1a18 100%)";

export function WorldOverview({ detail }: { detail: WorldDetail }) {
  const { world, source } = detail;

  const stats = [
    { label: "Characters", value: world.characters.length },
    { label: "Groups", value: world.groups.length },
    { label: "Roles", value: world.roles.length },
    { label: "Events", value: world.eventTemplates.length },
    { label: "Metrics", value: world.metrics?.length ?? 0 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, fontFamily: T.fontBody }}>
      {/* Hero */}
      <section style={{
        background: GRADIENT,
        borderRadius: 16,
        padding: "32px 36px",
        border: `1px solid ${T.border}`,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
        }}>
          <span style={{
            fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: T.dim,
          }}>
            {source}
          </span>
          <span style={{ color: T.dim }}>·</span>
          <span style={{
            fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
            letterSpacing: "0.08em", textTransform: "uppercase",
            color: T.dim,
          }}>
            {world.id}
          </span>
        </div>
        <h1 style={{
          fontFamily: T.fontHeading, fontSize: 40, fontWeight: 600,
          letterSpacing: "-0.03em", lineHeight: "44px", margin: 0,
          color: T.fg,
        }}>
          {world.title}
        </h1>
        {world.setting && (
          <p style={{
            fontFamily: T.fontBody, fontSize: 14, fontWeight: 400,
            lineHeight: "22px", color: "rgba(241, 245, 249, 0.72)",
            margin: "12px 0 0", maxWidth: 720,
          }}>
            {world.setting}
          </p>
        )}
      </section>

      {/* Stats */}
      <section style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
        gap: 12,
      }}>
        {stats.map((s) => (
          <div key={s.label} style={{
            background: T.panel, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: "18px 20px",
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            <div style={{
              fontFamily: T.fontHeading, fontSize: 32, fontWeight: 300,
              letterSpacing: "-0.02em", lineHeight: "36px", color: T.fg,
            }}>
              {s.value}
            </div>
            <div style={{
              fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
              letterSpacing: "0.1em", textTransform: "uppercase",
              color: T.dim,
            }}>
              {s.label}
            </div>
          </div>
        ))}
      </section>

      {/* Premise + Narrator */}
      <section style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16,
      }}>
        <Card title="Premise">
          <p style={bodyParagraph}>{world.premise}</p>
        </Card>
        <Card title="Intro narration">
          <p style={{ ...bodyParagraph, fontStyle: "italic", color: "rgba(241, 245, 249, 0.82)" }}>
            {world.introNarration}
          </p>
        </Card>
      </section>

      {/* Characters */}
      <Card title="Characters" count={world.characters.length}>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12,
        }}>
          {world.characters.map((character) => (
            <div key={character.id} style={subCard}>
              <div style={{
                fontFamily: T.fontHeading, fontSize: 16, fontWeight: 600,
                letterSpacing: "-0.01em", color: T.fg, lineHeight: "20px",
              }}>
                {character.name}
              </div>
              <div style={{
                fontFamily: T.fontMono, fontSize: 10, fontWeight: 400,
                letterSpacing: "0.08em", textTransform: "uppercase",
                color: T.dim, marginTop: 4,
              }}>
                {character.title} · {character.archetype}
              </div>
              {character.backstory && (
                <p style={{
                  fontFamily: T.fontBody, fontSize: 12, fontWeight: 400,
                  lineHeight: "18px", color: T.muted,
                  margin: "10px 0 0",
                  display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>
                  {character.backstory}
                </p>
              )}
              {character.tags && character.tags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                  {character.tags.slice(0, 5).map((tag) => (
                    <span key={tag} style={tagPill("#FBA7C0")}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Groups */}
      {world.groups.length > 0 && (
        <Card title="Groups" count={world.groups.length}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12,
          }}>
            {world.groups.map((group) => (
              <div key={group.id} style={subCard}>
                <div style={{
                  fontFamily: T.fontHeading, fontSize: 16, fontWeight: 600,
                  letterSpacing: "-0.01em", color: T.fg, lineHeight: "20px",
                }}>
                  {group.name}
                </div>
                <div style={{
                  fontFamily: T.fontMono, fontSize: 10, fontWeight: 400,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  color: T.dim, marginTop: 4,
                }}>
                  Influence {group.influence} · {group.disposition}
                  {group.powerType ? ` · ${group.powerType}` : ""}
                </div>
                <p style={{
                  fontFamily: T.fontBody, fontSize: 12, fontWeight: 400,
                  lineHeight: "18px", color: T.muted,
                  margin: "10px 0 0",
                  display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>
                  {group.description}
                </p>
                {group.tags && group.tags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                    {group.tags.slice(0, 5).map((tag) => (
                      <span key={tag} style={tagPill("#8FD1CB")}>{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Events */}
      {world.eventTemplates.length > 0 && (
        <Card title="Event templates" count={world.eventTemplates.length}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {world.eventTemplates.slice(0, 8).map((event) => (
              <div key={event.id} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px", borderRadius: 8,
                background: "rgba(255, 255, 255, 0.02)",
              }}>
                <span style={{
                  fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "#A5B4FC", width: 100, flexShrink: 0,
                }}>
                  {event.category}
                </span>
                <span style={{
                  fontFamily: T.fontBody, fontSize: 13, fontWeight: 500,
                  color: T.fg, flex: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {event.title}
                </span>
                <span style={{
                  fontFamily: T.fontMono, fontSize: 10, fontWeight: 400,
                  color: T.dim, flexShrink: 0,
                }}>
                  urgency {event.urgency}
                </span>
              </div>
            ))}
            {world.eventTemplates.length > 8 && (
              <div style={{
                fontFamily: T.fontMono, fontSize: 10, fontWeight: 400,
                letterSpacing: "0.08em", textTransform: "uppercase",
                color: T.dim, padding: "6px 12px",
              }}>
                +{world.eventTemplates.length - 8} more
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

function Card({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section style={{
      background: T.panel, border: `1px solid ${T.border}`,
      borderRadius: 12, padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <header style={{
        display: "flex", alignItems: "baseline", gap: 10,
      }}>
        <h2 style={{
          fontFamily: T.fontHeading, fontSize: 22, fontWeight: 600,
          letterSpacing: "-0.02em", lineHeight: "28px", margin: 0,
          color: T.fg,
        }}>
          {title}
        </h2>
        {count !== undefined && (
          <span style={{
            fontFamily: T.fontMono, fontSize: 11, fontWeight: 400,
            letterSpacing: "0.08em", color: T.dim,
          }}>
            {count}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

const bodyParagraph: React.CSSProperties = {
  fontFamily: T.fontBody, fontSize: 14, fontWeight: 400,
  lineHeight: "22px", color: "rgba(255, 255, 255, 0.72)",
  margin: 0,
};

const subCard: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.02)",
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: "14px 16px",
};

function tagPill(color: string): React.CSSProperties {
  return {
    fontFamily: T.fontMono, fontSize: 10, fontWeight: 400,
    letterSpacing: "0.06em", padding: "2px 7px",
    borderRadius: 4, color: color,
    background: "rgba(255, 255, 255, 0.04)",
  };
}
