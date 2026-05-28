import type { WorldDetail } from "@odyssey/db";

const T = {
  fg: "#F1F5F9",
  muted: "#8B96A8",
  dim: "#5A6478",
  panel: "var(--surface-1)",
  border: "var(--border)",
  accent: "#8FD1CB",
  danger: "#F87171",
  fontHeading: "'Space Grotesk', system-ui, sans-serif",
  fontBody: "'Inter', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
};

export function WorldSettingsPanel({ detail }: { detail: WorldDetail }) {
  const { world, source, editable, record } = detail;

  const sections: {
    number: string;
    title: string;
    description: string;
    rows: { label: string; value: React.ReactNode; mono?: boolean }[];
  }[] = [
    {
      number: "01",
      title: "Identity",
      description: "Title, tagline, and the slug used across the URL and APIs.",
      rows: [
        { label: "Title", value: world.title },
        { label: "ID", value: world.id, mono: true },
        { label: "Setting", value: world.setting },
      ],
    },
    {
      number: "02",
      title: "Narrative",
      description: "The premise and intro narration that frame every session.",
      rows: [
        { label: "Premise", value: world.premise },
        { label: "Intro narration", value: world.introNarration },
      ],
    },
    {
      number: "03",
      title: "Composition",
      description: "Inventory of entities that make up this world.",
      rows: [
        { label: "Characters", value: `${world.characters.length}` },
        { label: "Groups", value: `${world.groups.length}` },
        { label: "Roles", value: `${world.roles.length}` },
        { label: "Event templates", value: `${world.eventTemplates.length}` },
        { label: "Metrics", value: `${world.metrics?.length ?? 0}` },
      ],
    },
    {
      number: "04",
      title: "Provenance",
      description: "Where this world lives and whether it can be edited in place.",
      rows: [
        { label: "Source", value: source, mono: true },
        { label: "Editable", value: editable ? "yes" : "no", mono: true },
        { label: "Version", value: record?.version ? `v${record.version}` : "—", mono: true },
        { label: "Created", value: record?.createdAt ? new Date(record.createdAt).toLocaleString() : "—", mono: true },
        { label: "Updated", value: record?.updatedAt ? new Date(record.updatedAt).toLocaleString() : "—", mono: true },
      ],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)", fontFamily: T.fontBody }}>
      <header>
        <div style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
          letterSpacing: "0.1em", textTransform: "uppercase", color: T.dim,
        }}>
          Settings
        </div>
        <h1 style={{
          fontFamily: T.fontHeading, fontSize: 26, fontWeight: 600,
          letterSpacing: "-0.02em", lineHeight: "32px", margin: "6px 0 0", color: T.fg,
        }}>
          {world.title}
        </h1>
      </header>

      {sections.map((section) => (
        <section key={section.number} style={{
          background: T.panel, border: `1px solid ${T.border}`,
          borderRadius: "var(--radius-xl)", padding: "22px 24px",
        }}>
          <header style={{ display: "flex", alignItems: "baseline", gap: "var(--space-12)", marginBottom: "var(--space-14)" }}>
            <span style={{
              fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
              letterSpacing: "0.1em", color: T.dim,
            }}>
              {section.number}
            </span>
            <h2 style={{
              fontFamily: T.fontHeading, fontSize: "var(--font-size-3xl)", fontWeight: 600,
              letterSpacing: "-0.02em", lineHeight: "28px", margin: 0, color: T.fg,
            }}>
              {section.title}
            </h2>
          </header>
          <p style={{
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted,
            lineHeight: "18px", margin: "0 0 16px", maxWidth: 640,
          }}>
            {section.description}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {section.rows.map((row) => (
              <div key={row.label} style={{
                display: "grid", gridTemplateColumns: "180px 1fr", gap: "var(--space-16)",
                padding: "10px 0", borderBottom: `1px solid ${T.border}`,
                alignItems: "baseline",
              }}>
                <div style={{
                  fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
                  letterSpacing: "0.08em", textTransform: "uppercase", color: T.dim,
                }}>
                  {row.label}
                </div>
                <div style={{
                  fontFamily: row.mono ? T.fontMono : T.fontBody,
                  fontSize: row.mono ? 12 : 14, color: T.fg,
                  lineHeight: row.mono ? "16px" : "22px",
                  whiteSpace: "pre-wrap",
                }}>
                  {row.value || "—"}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Danger zone */}
      <section style={{
        background: T.panel,
        border: `1px solid rgba(248, 113, 113, 0.2)`,
        borderRadius: "var(--radius-xl)", padding: "22px 24px",
      }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: "var(--space-12)", marginBottom: "var(--space-10)" }}>
          <span style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500,
            letterSpacing: "0.1em", color: T.dim,
          }}>
            05
          </span>
          <h2 style={{
            fontFamily: T.fontHeading, fontSize: "var(--font-size-3xl)", fontWeight: 600,
            letterSpacing: "-0.02em", lineHeight: "28px", margin: 0, color: T.danger,
          }}>
            Danger zone
          </h2>
        </header>
        <p style={{
          fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted,
          lineHeight: "18px", margin: "0 0 16px", maxWidth: 640,
        }}>
          {editable
            ? "Archiving removes the world from Live filters but preserves its sessions. Deletion is permanent."
            : "This world is static and sourced from code. It cannot be archived or deleted from the admin."}
        </p>
        <div style={{ display: "flex", gap: "var(--space-10)" }}>
          <button
            type="button"
            disabled={!editable}
            style={{
              padding: "7px 14px", borderRadius: "var(--radius-md)",
              border: `1px solid ${T.border}`, background: "transparent",
              color: editable ? T.fg : T.dim,
              fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 500,
              cursor: editable ? "pointer" : "not-allowed",
            }}
          >
            Archive
          </button>
          <button
            type="button"
            disabled={!editable}
            style={{
              padding: "7px 14px", borderRadius: "var(--radius-md)", border: "none",
              background: editable ? "rgba(248, 113, 113, 0.12)" : "rgba(255,255,255,0.04)",
              color: editable ? T.danger : T.dim,
              fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 600,
              cursor: editable ? "pointer" : "not-allowed",
            }}
          >
            Delete world
          </button>
        </div>
      </section>
    </div>
  );
}
