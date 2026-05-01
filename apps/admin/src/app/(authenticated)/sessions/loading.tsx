import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

const COLS = ["ID", "World", "Role", "Status", "Version", "Created", "Last active"];
const GRID_COLS = "minmax(140px,1.4fr) minmax(140px,1.6fr) 100px 100px 100px 140px 140px";

export default function SessionsLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Skeleton width={140} height={20} />
        <Skeleton width={36} height={14} />
      </div>

      <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLS,
            padding: "12px 16px",
            borderBottom: "1px solid var(--card-border)",
            background: "var(--panel)",
            gap: 12,
          }}
        >
          {COLS.map((c) => (
            <Skeleton key={c} width={Math.max(48, c.length * 6)} height={11} static />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLS,
              alignItems: "center",
              padding: "14px 16px",
              borderBottom: i === 7 ? "none" : "1px solid var(--card-border)",
              gap: 12,
            }}
          >
            <Skeleton width="70%" height={12} />
            <Skeleton width="60%" height={13} />
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
