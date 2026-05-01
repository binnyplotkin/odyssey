import { Skeleton, SkeletonText } from "@odyssey/ui";

export default function DocDetailLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 880, margin: "0 auto" }}>
      {/* Hero gradient */}
      <div
        style={{
          height: 180,
          borderRadius: 14,
          background: "var(--card-hover)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 28,
            bottom: 24,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <Skeleton width={120} height={11} />
          <Skeleton width={320} height={28} />
        </div>
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Skeleton width={20} height={20} variant="circle" />
        <Skeleton width={140} height={12} />
        <div style={{ flex: 1 }} />
        <Skeleton width={88} height={11} />
      </div>

      {/* Body — three "paragraphs" */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Skeleton width={220} height={18} />
        <SkeletonText lines={5} lineHeight={14} gap={9} />

        <Skeleton width={180} height={16} />
        <SkeletonText lines={4} lineHeight={14} gap={9} />

        <Skeleton width={200} height={16} />
        <SkeletonText lines={6} lineHeight={14} gap={9} lastLineWidth="40%" />
      </div>
    </div>
  );
}
