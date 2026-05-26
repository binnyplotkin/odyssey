"use client";

import { useEffect } from "react";
import { Skeleton } from "@odyssey/ui";
import { useHeaderContent } from "@/components/header-context";

// Matches the live character-chat layout:
//   • Top horizontal SceneBar (entities · location · budget · era · model)
//   • Left chat column: messages scroll + composer dock
//   • Right TracePanel (graph + per-turn trace)

function MessageBubble({ side, lines = 2 }: { side: "left" | "right"; lines?: number }) {
  const widths = ["72%", "60%", "84%", "50%"];
  return (
    <div
      style={{
        display: "flex",
        justifyContent: side === "right" ? "flex-end" : "flex-start",
        gap: "var(--space-10)",
      }}
    >
      {side === "left" && <Skeleton width={28} height={28} variant="circle" />}
      <div
        style={{
          maxWidth: "60%",
          padding: "10px 14px",
          borderRadius: "var(--radius-2xl)",
          background: side === "right" ? "var(--accent-soft)" : "var(--panel)",
          border: side === "right"
            ? "1px solid var(--accent-soft)"
            : "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} width={widths[(i + (side === "right" ? 1 : 0)) % widths.length]} height={12} />
        ))}
      </div>
    </div>
  );
}

function SceneBarChip({ label, value }: { label: number; value: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "6px 10px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        background: "var(--panel)",
      }}
    >
      <Skeleton width={label} height={9} />
      <Skeleton width={value} height={11} />
    </div>
  );
}

export default function CharacterChatLoading() {
  const { setFlush } = useHeaderContent();

  useEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--background)" }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left column: scene bar + messages + composer */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
            borderRight: "1px solid var(--border)",
          }}
        >
          {/* Scene bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-10)",
              padding: "12px 24px",
              borderBottom: "1px solid var(--border)",
              flexWrap: "wrap",
            }}
          >
            <SceneBarChip label={36} value={64} />
            <SceneBarChip label={48} value={80} />
            <SceneBarChip label={44} value={56} />
            <div style={{ flex: 1 }} />
            <SceneBarChip label={32} value={88} />
            <SceneBarChip label={36} value={92} />
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              padding: "24px 32px",
              display: "flex",
              flexDirection: "column",
              gap: 22,
            }}
          >
            <MessageBubble side="left" lines={2} />
            <MessageBubble side="right" lines={1} />
            <MessageBubble side="left" lines={3} />
            <MessageBubble side="right" lines={2} />
            <MessageBubble side="left" lines={2} />
          </div>

          {/* Composer */}
          <div
            style={{
              padding: "14px 24px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-10)",
            }}
          >
            <Skeleton width="100%" height={38} radius={10} />
            <Skeleton width={38} height={38} variant="circle" />
          </div>
        </div>

        {/* Right: trace / graph panel */}
        <div
          style={{
            width: 360,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-16)",
            padding: "20px 18px",
            background: "var(--sidebar-glass)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Skeleton width={110} height={13} />
            <Skeleton width={48} height={20} radius={999} static />
          </div>
          {/* Graph placeholder */}
          <div
            style={{
              height: 220,
              borderRadius: "var(--radius-xl)",
              background: "var(--panel)",
              border: "1px solid var(--border)",
            }}
          />
          {/* Trace rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  padding: "10px 12px",
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-6)",
                }}
              >
                <Skeleton width="55%" height={11} />
                <Skeleton width="80%" height={10} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
