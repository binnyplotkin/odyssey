import { Skeleton } from "@odyssey/ui";

export default function EngineLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <Skeleton width={120} height={18} />
        <div style={{ flex: 1 }} />
        <Skeleton width={180} height={28} radius={8} />
        <Skeleton width={88} height={28} radius={8} />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: "var(--panel)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <Skeleton width={120} height={120} variant="circle" />
          <Skeleton width={180} height={13} />
        </div>

        {/* Floating side panel */}
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 260,
            background: "var(--card)",
            border: "1px solid var(--card-border)",
            borderRadius: 12,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <Skeleton width={100} height={11} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Skeleton width={10} height={10} variant="circle" static />
              <Skeleton width="70%" height={12} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
