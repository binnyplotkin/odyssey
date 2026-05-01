import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

export default function CharacterSourcesLoading() {
  return (
    <div style={{ display: "flex", gap: 16, height: "100%" }}>
      {/* Source list */}
      <div
        style={{
          ...CARD,
          width: 320,
          flexShrink: 0,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          overflow: "hidden",
        }}
      >
        <Skeleton width="100%" height={28} radius={6} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "10px 12px",
                borderRadius: 8,
                background: i === 0 ? "var(--accent-soft)" : "transparent",
                border: "1px solid var(--card-border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Skeleton width={48} height={16} radius={999} static />
                <Skeleton width="55%" height={12} />
              </div>
              <Skeleton width="40%" height={10} />
            </div>
          ))}
        </div>
      </div>

      {/* Source detail */}
      <div
        style={{
          ...CARD,
          flex: 1,
          minWidth: 0,
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <Skeleton width={56} height={18} radius={999} static />
            <Skeleton width="55%" height={22} />
            <Skeleton width="40%" height={12} />
          </div>
          <Skeleton width={120} height={28} radius={8} />
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            gap: 20,
            paddingTop: 12,
            paddingBottom: 12,
            borderTop: "1px solid var(--card-border)",
            borderBottom: "1px solid var(--card-border)",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Skeleton width={56} height={10} />
              <Skeleton width={32} height={18} />
            </div>
          ))}
        </div>

        <Skeleton width={120} height={13} />

        {/* Reference rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--card-border)",
              }}
            >
              <Skeleton width={32} height={11} />
              <Skeleton width="55%" height={12} />
              <div style={{ flex: 1 }} />
              <Skeleton width={48} height={11} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
