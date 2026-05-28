const featureColors: Record<string, string> = {
  "1": "#8B5CF6",
  "2": "#C8875A",
  "3": "#E8A838",
  "4": "#4ECDC4",
  "5": "#FF6B6B",
};

function getFeatureColor(work: string): string {
  const match = work.match(/Feature\s+(\d)/);
  return match ? featureColors[match[1]] ?? "var(--accent)" : "var(--accent)";
}

/**
 * Usage in MDX:
 *   <Workstream name="Josh" data="Apr 16 – May 6 (3 wk) | Feature 1: Voice pipeline
 *   May 7 – May 23 (2.5 wk) | Feature 3: Multi-voice TTS routing" />
 *
 * Each line is a row. Columns are separated by " | ".
 */
export function Workstream({
  name,
  data,
}: {
  name: string;
  data: string;
}) {
  const rows = data
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("|");
      if (idx === -1) return { weeks: line, work: "" };
      return { weeks: line.slice(0, idx).trim(), work: line.slice(idx + 1).trim() };
    });

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      background: "var(--surface-1)",
      overflow: "hidden",
      marginTop: "var(--space-8)",
      marginBottom: "var(--space-16)",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
      }}>
        <div style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "rgba(143,209,203,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.6875rem",
          fontWeight: 700,
          color: "var(--accent)",
          flexShrink: 0,
        }}>
          {name.charAt(0).toUpperCase()}
        </div>
        <span style={{
          fontWeight: 600,
          fontSize: "0.875rem",
          color: "var(--foreground)",
        }}>
          {name}
        </span>
      </div>

      {/* Rows */}
      {rows.map((row, i) => {
        const color = getFeatureColor(row.work);
        return (
          <div
            key={i}
            style={{
              display: "flex",
              borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            {/* Weeks column */}
            <div style={{
              width: 160,
              flexShrink: 0,
              padding: "10px 16px",
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}>
              <span style={{
                fontSize: "0.8125rem",
                fontWeight: 500,
                color: "var(--foreground)",
                whiteSpace: "nowrap",
              }}>
                {row.weeks.replace(/\s*\(.*\)/, "")}
              </span>
              {row.weeks.match(/\(.*\)/) && (
                <span style={{
                  fontSize: "0.6875rem",
                  color: "var(--text-tertiary)",
                }}>
                  {row.weeks.match(/\(.*\)/)?.[0]}
                </span>
              )}
            </div>

            {/* Work column */}
            <div style={{
              flex: 1,
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
            }}>
              <div style={{
                width: 3,
                alignSelf: "stretch",
                borderRadius: "var(--radius-2xs)",
                background: color,
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: "0.8125rem",
                color: "var(--foreground)",
                lineHeight: 1.5,
              }}>
                {row.work}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
