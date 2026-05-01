import { Skeleton, SkeletonText } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

export default function WikiPageDetailLoading() {
  return (
    <div style={{ display: "flex", gap: 16, height: "100%" }}>
      {/* Sidebar: page tree */}
      <div
        style={{
          ...CARD,
          width: 260,
          flexShrink: 0,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <Skeleton width="100%" height={28} radius={6} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingLeft: i % 3 === 0 ? 0 : 14,
                padding: "6px 8px",
                borderRadius: 6,
                background: i === 2 ? "var(--accent-soft)" : "transparent",
              }}
            >
              <Skeleton width={10} height={10} variant="circle" static />
              <Skeleton width={`${50 + (i % 5) * 8}%`} height={12} />
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div
        style={{
          ...CARD,
          flex: 1,
          minWidth: 0,
          padding: "24px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Skeleton width={56} height={20} radius={999} static />
          <Skeleton width={120} height={11} />
          <div style={{ flex: 1 }} />
          <Skeleton width={28} height={28} radius={6} />
          <Skeleton width={88} height={28} radius={6} />
        </div>

        <Skeleton width="60%" height={28} />

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SkeletonText lines={5} lineHeight={14} gap={9} />
          <Skeleton width="40%" height={18} style={{ marginTop: 8 }} />
          <SkeletonText lines={4} lineHeight={14} gap={9} />
          <Skeleton width="35%" height={18} style={{ marginTop: 8 }} />
          <SkeletonText lines={6} lineHeight={14} gap={9} lastLineWidth="50%" />
        </div>
      </div>
    </div>
  );
}
