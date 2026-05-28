import { Skeleton } from "@odyssey/ui";

const PANEL: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
};

function WorldCardSkeleton() {
  return (
    <div
      style={{
        ...PANEL,
        width: 320,
        borderRadius: "var(--radius-2xl)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 110, background: "var(--surface-hover)", position: "relative" }}>
        <div style={{ position: "absolute", top: 12, right: 12 }}>
          <Skeleton width={56} height={20} radius={999} static />
        </div>
      </div>
      <div style={{ padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
        <Skeleton width="65%" height={18} />
        <Skeleton width={88} height={11} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <Skeleton width="100%" height={12} />
          <Skeleton width="80%" height={12} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-18)",
            paddingTop: "var(--space-12)",
            borderTop: "1px solid var(--border)",
          }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <Skeleton width={28} height={20} />
              <Skeleton width={48} height={9} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function WorldsLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-16)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-16)" }}>
          <div
            style={{
              ...PANEL,
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
              padding: "0.5rem 0.75rem",
              borderRadius: "var(--radius-lg)",
              width: 320,
            }}
          >
            <Skeleton width={14} height={14} variant="circle" />
            <Skeleton width={140} height={13} />
          </div>
          <Skeleton width={140} height={11} />
        </div>
        <Skeleton width={150} height={32} radius={8} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-18)" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <WorldCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
