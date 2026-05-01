import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

export default function ChangelogLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Skeleton width={120} height={20} />
        <Skeleton width={120} height={28} radius={8} />
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[60, 80, 70, 90, 56].map((w, i) => (
          <Skeleton key={i} width={w} height={26} radius={999} static />
        ))}
      </div>

      {/* Entry list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              ...CARD,
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Skeleton width={64} height={18} radius={999} static />
              <Skeleton width={48} height={11} />
              <div style={{ flex: 1 }} />
              <Skeleton width={56} height={11} />
            </div>
            <Skeleton width="80%" height={15} />
            <Skeleton width="100%" height={12} />
            <Skeleton width="65%" height={12} />
          </div>
        ))}
      </div>
    </div>
  );
}
