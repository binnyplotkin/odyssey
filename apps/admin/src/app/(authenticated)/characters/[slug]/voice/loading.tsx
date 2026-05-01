import { Skeleton } from "@odyssey/ui";

export default function CharacterVoiceLoading() {
  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        background: "var(--panel)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Centered waveform placeholder */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        }}
      >
        {Array.from({ length: 24 }).map((_, i) => {
          const heights = [40, 80, 120, 90, 60, 110, 150, 70];
          const h = heights[i % heights.length];
          return <Skeleton key={i} width={6} height={h} radius={3} />;
        })}
      </div>

      {/* Bottom dock */}
      <div
        style={{
          position: "absolute",
          left: 24,
          right: 24,
          bottom: 24,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: "var(--card)",
          border: "1px solid var(--card-border)",
          borderRadius: 999,
        }}
      >
        <Skeleton width={36} height={36} variant="circle" />
        <Skeleton width="60%" height={12} />
        <div style={{ flex: 1 }} />
        <Skeleton width={56} height={28} radius={999} />
        <Skeleton width={28} height={28} variant="circle" />
      </div>
    </div>
  );
}
