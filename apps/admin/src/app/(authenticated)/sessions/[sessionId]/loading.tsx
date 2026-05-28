import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--material-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-xl)",
};

export default function SessionDetailLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <Skeleton width={28} height={28} radius={6} />
        <Skeleton width={180} height={20} />
        <Skeleton width={140} height={12} />
      </div>

      {/* Stats grid */}
      <div
        style={{
          ...CARD,
          padding: "16px 20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "var(--space-16)",
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            <Skeleton width={64} height={10} />
            <Skeleton width={80} height={18} />
          </div>
        ))}
      </div>

      {/* Turn history */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Skeleton width={140} height={14} />
        <Skeleton width={56} height={11} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              ...CARD,
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-12)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
              <Skeleton width={32} height={18} radius={999} static />
              <Skeleton width={56} height={11} />
              <div style={{ flex: 1 }} />
              <Skeleton width={80} height={11} />
            </div>
            <Skeleton width="92%" height={13} />
            <Skeleton width="60%" height={13} />
            <div
              style={{
                paddingTop: "var(--space-10)",
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-6)",
              }}
            >
              <Skeleton width="80%" height={12} />
              <Skeleton width="65%" height={12} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
