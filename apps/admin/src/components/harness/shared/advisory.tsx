/**
 * Shared advisory stack — used by L01 Identity, L02 Directive, L03
 * Voice Style (and any future layer that wants live authoring-quality
 * chips above its preview).
 *
 * Each editor still computes its own advisory rules (since they're
 * domain-specific) — only the render is shared. Severity `warn` sorts
 * before `info`, then the order the caller passed them in is preserved.
 *
 * Why shared: by the time we built this in L03 it had already been
 * copy-pasted three times. The shape never changed across copies, so
 * extraction is pure code-dedup with no behavior risk.
 */

const T = {
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

export type Advisory = {
  severity: "warn" | "info";
  /** Short uppercase chip label. Caller sets sentence-case; the renderer doesn't normalize. */
  title: string;
  /** One- to three-sentence explanation. Should explain the why (citation, mechanism, risk),
   * not just the what — authors learn the model that way. */
  body: string;
};

export function AdvisoryStack({ advisories }: { advisories: Advisory[] }) {
  if (advisories.length === 0) return null;
  const sorted = [...advisories].sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "warn" ? -1 : 1;
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      {sorted.map((a, i) => {
        const colors =
          a.severity === "warn"
            ? {
                bg: "rgba(255,184,112,0.04)",
                border: "rgba(255,184,112,0.18)",
                accent: "rgba(255,184,112,0.95)",
                glyph: "⚠",
                label: "advisory",
              }
            : {
                bg: "rgba(140,231,210,0.03)",
                border: "rgba(140,231,210,0.14)",
                accent: "rgba(140,231,210,0.85)",
                glyph: "i",
                label: "guidance",
              };
        return (
          <div
            key={`${a.title}-${i}`}
            style={{
              display: "flex",
              gap: "var(--space-12)",
              padding: "10px 14px",
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: "var(--radius-sm)",
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                color: colors.accent,
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-base)",
                width: 14,
                textAlign: "center",
              }}
            >
              {colors.glyph}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 9.5,
                  letterSpacing: "0.12em",
                  color: colors.accent,
                  textTransform: "uppercase",
                }}
              >
                {colors.label} · {a.title}
              </span>
              <span
                style={{
                  fontFamily: T.fontBody,
                  fontSize: 11.5,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {a.body}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
