import { Skeleton } from "@odyssey/ui";

export default function WorldEditorLoading() {
  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Left rail: object tree */}
      <div
        style={{
          width: 220,
          borderRight: "1px solid var(--border)",
          padding: "var(--space-14)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-10)",
          flexShrink: 0,
        }}
      >
        <Skeleton width={88} height={11} />
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
              paddingLeft: i % 3 === 0 ? 0 : 14,
            }}
          >
            <Skeleton width={10} height={10} variant="circle" static />
            <Skeleton width={`${60 + (i % 4) * 8}%`} height={12} />
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
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
          }}
        >
          <Skeleton width={140} height={140} variant="circle" />
        </div>
      </div>

      {/* Right rail: inspector */}
      <div
        style={{
          width: 280,
          borderLeft: "1px solid var(--border)",
          padding: "var(--space-14)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-12)",
          flexShrink: 0,
        }}
      >
        <Skeleton width={100} height={11} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <Skeleton width={64} height={10} />
            <Skeleton width="100%" height={28} radius={6} />
          </div>
        ))}
      </div>
    </div>
  );
}
