/**
 * Usage in MDX:
 *   <Timeline data="F1: Voice Pipeline | Apr 15 – May 9 | Apr 16 – May 6 | Same
 *   F2: Knowledge Graph | May 9 – Jun 10 | Apr 16 – May 20 | Starts 3.5 weeks earlier" />
 *
 * Each line is a row. Columns: feature | previous | compressed | delta.
 */
export function Timeline({ data }: { data: string }) {
  const rows = data
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((s) => s.trim());
      return {
        feature: parts[0] ?? "",
        previous: parts[1] ?? "",
        compressed: parts[2] ?? "",
        delta: parts[3] ?? "",
      };
    });

  const headers = ["Feature", "Previous", "Compressed", "Delta"];

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      background: "var(--panel)",
      overflow: "hidden",
      marginTop: "var(--space-8)",
      marginBottom: "var(--space-16)",
    }}>
      {/* Header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 1fr 1.2fr",
        borderBottom: "1px solid var(--border)",
        background: "rgba(255,255,255,0.02)",
      }}>
        {headers.map((h) => (
          <div key={h} style={{
            padding: "8px 14px",
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>
            {h}
          </div>
        ))}
      </div>

      {/* Data rows */}
      {rows.map((row, i) => {
        const isVersion = row.feature.toLowerCase().includes("version");
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 1fr 1.2fr",
              borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
              background: isVersion ? "rgba(143,209,203,0.04)" : "none",
            }}
          >
            <div style={{
              padding: "8px 14px",
              fontSize: "0.8125rem",
              fontWeight: isVersion ? 600 : 500,
              color: "var(--foreground)",
            }}>
              {row.feature}
            </div>
            <div style={{
              padding: "8px 14px",
              fontSize: "0.8125rem",
              color: "var(--muted)",
              textDecoration: "line-through",
              opacity: 0.6,
            }}>
              {row.previous}
            </div>
            <div style={{
              padding: "8px 14px",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--foreground)",
            }}>
              {row.compressed}
            </div>
            <div style={{
              padding: "8px 14px",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: row.delta.toLowerCase().includes("earlier") ? "#34d399"
                : row.delta.toLowerCase() === "same" ? "var(--muted)"
                : "var(--accent)",
            }}>
              {row.delta}
            </div>
          </div>
        );
      })}
    </div>
  );
}
