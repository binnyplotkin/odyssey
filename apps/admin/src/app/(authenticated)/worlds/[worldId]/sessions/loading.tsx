import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: "var(--radius-xl)",
};

const COLS = ["ID", "Role", "Status", "Version", "Created", "Last active"];
const GRID_COLS = "minmax(140px,1.4fr) 100px 100px 100px 140px 140px";

export default function WorldSessionsLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <Skeleton width={120} height={18} />
          <Skeleton width={36} height={14} />
        </div>
        <Skeleton width={120} height={28} radius={8} />
      </div>

      <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLS,
            padding: "12px 16px",
            borderBottom: "1px solid var(--card-border)",
            background: "var(--panel)",
            gap: "var(--space-12)",
          }}
        >
          {COLS.map((c) => (
            <Skeleton key={c} width={Math.max(48, c.length * 6)} height={11} static />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLS,
              alignItems: "center",
              padding: "14px 16px",
              borderBottom: i === 5 ? "none" : "1px solid var(--card-border)",
              gap: "var(--space-12)",
            }}
          >
            <Skeleton width="70%" height={12} />
            <Skeleton width={48} height={18} radius={999} static />
            <Skeleton width={56} height={18} radius={999} static />
            <Skeleton width={48} height={12} />
            <Skeleton width={84} height={12} />
            <Skeleton width={84} height={12} />
          </div>
        ))}
      </div>
    </div>
  );
}
