import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

const COLS = ["Status", "Started", "Model", "Pages", "Edges", "Tokens", "Error"];
const GRID_COLS = "100px 140px 120px 80px 80px 96px minmax(160px,1fr)";

function StatBlock() {
  return (
    <div style={{ ...CARD, padding: "16px 20px", flex: 1, minWidth: 200 }}>
      <Skeleton width={120} height={10} style={{ marginBottom: 8 }} />
      <Skeleton width={100} height={26} style={{ marginBottom: 4 }} />
      <Skeleton width={80} height={11} />
    </div>
  );
}

export default function IngestionLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Stats header */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatBlock />
        <StatBlock />
        <StatBlock />
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[80, 96, 84].map((w, i) => (
            <Skeleton key={i} width={w} height={26} radius={999} static />
          ))}
        </div>
        <Skeleton width={140} height={28} radius={8} />
      </div>

      {/* Run history table */}
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
            <Skeleton key={c} width={Math.max(40, c.length * 6)} height={11} static />
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
            <Skeleton width={64} height={18} radius={999} static />
            <Skeleton width={88} height={12} />
            <Skeleton width={72} height={12} />
            <Skeleton width={32} height={12} />
            <Skeleton width={32} height={12} />
            <Skeleton width={56} height={12} />
            <Skeleton width="80%" height={12} />
          </div>
        ))}
      </div>
    </div>
  );
}
