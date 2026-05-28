import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--material-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-xl)",
};

function StatCard({ label, value }: { label: number; value: number }) {
  return (
    <div style={{ ...CARD, padding: "14px 16px", flex: 1, minWidth: 140 }}>
      <Skeleton width={label} height={10} style={{ marginBottom: "var(--space-6)" }} />
      <Skeleton width={value} height={24} />
    </div>
  );
}

function PanelCard({ rows }: { rows: number }) {
  return (
    <div style={{ ...CARD, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "var(--space-14)" }}>
        <Skeleton width={120} height={13} />
        <div style={{ flex: 1 }} />
        <Skeleton width={48} height={11} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-10)",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <Skeleton width={28} height={28} variant="circle" />
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", flex: 1 }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
      <div style={{ display: "flex", gap: "var(--space-12)", flexWrap: "wrap" }}>
        <StatCard label={56} value={48} />
        <StatCard label={64} value={40} />
        <StatCard label={48} value={56} />
        <StatCard label={56} value={32} />
      </div>

      <div style={{ display: "flex", gap: "var(--space-18)", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
          <PanelCard rows={4} />
          <PanelCard rows={3} />
        </div>
        <div style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
          <PanelCard rows={3} />
          <PanelCard rows={2} />
        </div>
      </div>
    </div>
  );
}
