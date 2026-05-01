import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

function StatCard({ label, value }: { label: number; value: number }) {
  return (
    <div style={{ ...CARD, padding: "14px 16px", flex: 1, minWidth: 140 }}>
      <Skeleton width={label} height={10} style={{ marginBottom: 6 }} />
      <Skeleton width={value} height={24} />
    </div>
  );
}

function PanelCard({ rows }: { rows: number }) {
  return (
    <div style={{ ...CARD, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Skeleton width={120} height={13} />
        <div style={{ flex: 1 }} />
        <Skeleton width={48} height={11} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--card-border)",
            }}
          >
            <Skeleton width={28} height={28} variant="circle" />
            <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
              <Skeleton width="55%" height={12} />
              <Skeleton width="35%" height={10} />
            </div>
            <Skeleton width={48} height={11} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorldOverviewLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard label={56} value={48} />
        <StatCard label={64} value={40} />
        <StatCard label={48} value={56} />
        <StatCard label={56} value={32} />
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 18 }}>
          <PanelCard rows={4} />
          <PanelCard rows={3} />
        </div>
        <div style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          <PanelCard rows={3} />
          <PanelCard rows={2} />
        </div>
      </div>
    </div>
  );
}
