import { Skeleton } from "@odyssey/ui";

export default function EditorLoading() {
  return (
    <div style={{ display: "flex", height: "100%", gap: 0 }}>
      {/* Left rail */}
      <div
        style={{
          width: 240,
          borderRight: "1px solid var(--border)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          flexShrink: 0,
        }}
      >
        <Skeleton width={120} height={11} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--panel)",
              }}
            >
              <Skeleton width={12} height={12} variant="circle" static />
              <Skeleton width="70%" height={12} />
            </div>
          ))}
        </div>
      </div>

      {/* Canvas area */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          padding: 16,
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Skeleton width={140} height={18} />
          <div style={{ flex: 1 }} />
          <Skeleton width={32} height={28} radius={8} />
          <Skeleton width={32} height={28} radius={8} />
          <Skeleton width={96} height={28} radius={8} />
        </div>
        <div
          style={{
            flex: 1,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
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
            <Skeleton width={220} height={14} />
          </div>
        </div>
      </div>
    </div>
  );
}
