import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

function MessageBubble({ side, lines = 2 }: { side: "left" | "right"; lines?: number }) {
  const widths = ["72%", "60%", "84%", "50%"];
  return (
    <div
      style={{
        display: "flex",
        justifyContent: side === "right" ? "flex-end" : "flex-start",
        gap: 10,
      }}
    >
      {side === "left" && <Skeleton width={28} height={28} variant="circle" />}
      <div
        style={{
          maxWidth: "60%",
          padding: "10px 14px",
          borderRadius: 14,
          background: side === "right" ? "var(--accent-soft)" : "var(--panel)",
          border: side === "right" ? "1px solid var(--accent-soft)" : "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} width={widths[(i + (side === "right" ? 1 : 0)) % widths.length]} height={12} />
        ))}
      </div>
    </div>
  );
}

export default function CharacterChatLoading() {
  return (
    <div style={{ display: "flex", gap: 16, height: "100%" }}>
      {/* Scene/context sidebar */}
      <div
        style={{
          ...CARD,
          width: 300,
          flexShrink: 0,
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <Skeleton width={100} height={11} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton width={60} height={10} />
          <Skeleton width="100%" height={32} radius={6} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton width={72} height={10} />
          <Skeleton width="100%" height={32} radius={6} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[60, 80, 70, 56].map((w, i) => (
              <Skeleton key={i} width={w} height={20} radius={999} static />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton width={88} height={10} />
          <Skeleton width="100%" height={64} radius={6} />
        </div>
      </div>

      {/* Chat area */}
      <div
        style={{
          ...CARD,
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflow: "hidden",
          }}
        >
          <MessageBubble side="left" lines={2} />
          <MessageBubble side="right" lines={1} />
          <MessageBubble side="left" lines={3} />
          <MessageBubble side="right" lines={2} />
          <MessageBubble side="left" lines={2} />
        </div>

        {/* Input dock */}
        <div
          style={{
            padding: "14px 18px",
            borderTop: "1px solid var(--card-border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Skeleton width="100%" height={38} radius={10} />
          <Skeleton width={38} height={38} variant="circle" />
        </div>
      </div>
    </div>
  );
}
