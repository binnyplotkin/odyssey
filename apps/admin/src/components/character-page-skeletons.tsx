import { Skeleton, SkeletonText } from "@odyssey/ui";
import type { CSSProperties } from "react";

const GROUND = "#050505";
const PANEL = "#0A0A0A";
const BORDER = "rgba(255, 255, 255, 0.08)";
const DIVIDER = "rgba(255, 255, 255, 0.06)";

const shellStyle: CSSProperties = {
  minHeight: "calc(100vh - 67px)",
  background: GROUND,
  color: "var(--text-primary)",
  fontFamily: '"Inter", system-ui, sans-serif',
};

const panelStyle: CSSProperties = {
  background: PANEL,
  border: `1px solid ${BORDER}`,
};

function EyebrowSkeleton({
  stats = 3,
  actions = 1,
}: {
  stats?: number;
  actions?: number;
}) {
  return (
    <div
      style={{
        height: 44,
        borderBottom: `1px solid ${DIVIDER}`,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-16)",
        padding: "0 24px",
      }}
    >
      <Skeleton width={96} height={10} radius={3} />
      {Array.from({ length: stats }).map((_, i) => (
        <Skeleton key={i} width={72 + i * 18} height={10} radius={3} static />
      ))}
      <div style={{ flex: 1 }} />
      {Array.from({ length: actions }).map((_, i) => (
        <Skeleton key={i} width={72} height={24} radius={0} static />
      ))}
    </div>
  );
}

function FilterStripSkeleton({ chips = 5 }: { chips?: number }) {
  return (
    <div
      style={{
        minHeight: 56,
        borderBottom: `1px solid ${DIVIDER}`,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        padding: "10px 24px",
      }}
    >
      <div
        style={{
          width: 320,
          border: `1px solid ${BORDER}`,
          background: "rgba(255,255,255,0.02)",
          padding: "9px 12px",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-10)",
        }}
      >
        <Skeleton width={12} height={12} variant="circle" static />
        <Skeleton width={144} height={12} radius={3} />
      </div>
      {Array.from({ length: chips }).map((_, i) => (
        <Skeleton key={i} width={68 + (i % 3) * 18} height={28} radius={0} static />
      ))}
    </div>
  );
}

function GraphConstellationSkeleton() {
  const nodes = [
    { top: 20, left: 70, size: 38 },
    { top: 42, left: 252, size: 42 },
    { top: 132, left: 8, size: 34 },
    { top: 128, left: 330, size: 40 },
    { top: 250, left: 74, size: 42 },
    { top: 278, left: 254, size: 36 },
    { top: 162, left: 164, size: 58 },
  ];

  return (
    <div style={{ position: "relative", width: 390, height: 390 }}>
      <svg
        aria-hidden
        width="390"
        height="390"
        viewBox="0 0 390 390"
        style={{ position: "absolute", inset: 0, opacity: 0.34 }}
      >
        {nodes.slice(0, -1).map((n, i) => (
          <line
            key={i}
            x1={n.left + n.size / 2}
            y1={n.top + n.size / 2}
            x2={nodes[6].left + nodes[6].size / 2}
            y2={nodes[6].top + nodes[6].size / 2}
            stroke="var(--accent-strong)"
            strokeWidth="1"
          />
        ))}
      </svg>
      {nodes.map((node, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: node.top,
            left: node.left,
            width: node.size,
            height: node.size,
          }}
        >
          <Skeleton width="100%" height="100%" variant="circle" />
        </div>
      ))}
    </div>
  );
}

export function CharacterWikiRedirectLoadingSkeleton() {
  return (
    <div style={shellStyle}>
      <EyebrowSkeleton stats={3} actions={2} />
      <FilterStripSkeleton chips={6} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "480px minmax(0, 1fr)",
          gap: "var(--space-24)",
          minHeight: "calc(100vh - 167px)",
          padding: "16px 24px 24px",
        }}
      >
        <div style={{ ...panelStyle, padding: "var(--space-16)", overflow: "hidden" }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              style={{
                padding: "12px 10px",
                borderBottom: i === 8 ? "none" : `1px solid ${DIVIDER}`,
                display: "flex",
                alignItems: "center",
                gap: "var(--space-10)",
              }}
            >
              <Skeleton width={8} height={8} variant="circle" static />
              <Skeleton width={`${48 + (i % 5) * 8}%`} height={13} />
              <div style={{ flex: 1 }} />
              <Skeleton width={42} height={10} radius={3} static />
            </div>
          ))}
        </div>
        <div style={{ ...panelStyle, padding: "28px 32px", overflow: "hidden" }}>
          <Skeleton width={92} height={18} radius={0} static />
          <Skeleton width="54%" height={32} radius={4} style={{ marginTop: "var(--space-18)" }} />
          <SkeletonText lines={5} lineHeight={14} gap={10} style={{ marginTop: 28 }} />
          <Skeleton width="32%" height={20} radius={4} style={{ marginTop: "var(--space-20)" }} />
          <SkeletonText lines={7} lineHeight={14} gap={10} style={{ marginTop: "var(--space-16)" }} />
        </div>
      </div>
    </div>
  );
}

export function CharacterKnowledgeRedirectLoadingSkeleton() {
  return (
    <div style={shellStyle}>
      <EyebrowSkeleton stats={3} actions={2} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 380px",
          gap: 0,
          minHeight: "calc(100vh - 111px)",
        }}
      >
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundImage:
              "linear-gradient(var(--grid-color) 1px, transparent 1px), linear-gradient(90deg, var(--grid-color) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        >
          <GraphConstellationSkeleton />
          <div
            style={{
              position: "absolute",
              top: 18,
              left: 24,
              right: 24,
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
            }}
          >
            <Skeleton width={220} height={30} radius={0} />
            <div style={{ flex: 1 }} />
            {[80, 90, 74].map((w) => (
              <Skeleton key={w} width={w} height={28} radius={0} static />
            ))}
          </div>
        </div>
        <aside
          style={{
            ...panelStyle,
            borderTop: "none",
            borderBottom: "none",
            borderRight: "none",
            padding: "22px 24px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-16)",
          }}
        >
          <Skeleton width={92} height={10} radius={3} />
          <Skeleton width="72%" height={24} radius={4} />
          <SkeletonText lines={4} lineHeight={13} gap={8} />
          <div style={{ height: 1, background: DIVIDER, margin: "8px 0" }} />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} width={`${78 - i * 7}%`} height={12} />
          ))}
        </aside>
      </div>
    </div>
  );
}

export function CharacterSourcesRedirectLoadingSkeleton() {
  return (
    <div style={shellStyle}>
      <EyebrowSkeleton stats={4} actions={1} />
      <FilterStripSkeleton chips={4} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(360px, 0.9fr) minmax(0, 1.4fr)",
          gap: "var(--space-24)",
          padding: "20px 24px 32px",
        }}
      >
        <div style={{ ...panelStyle, padding: "var(--space-16)" }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              style={{
                padding: "14px 0",
                borderBottom: i === 6 ? "none" : `1px solid ${DIVIDER}`,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-8)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
                <Skeleton width={74} height={18} radius={0} static />
                <Skeleton width="52%" height={13} />
              </div>
              <Skeleton width="70%" height={11} />
            </div>
          ))}
        </div>
        <div style={{ ...panelStyle, padding: "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-12)" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
              <Skeleton width={70} height={20} radius={0} static />
              <Skeleton width="55%" height={24} />
              <Skeleton width="38%" height={12} />
            </div>
            <Skeleton width={120} height={30} radius={0} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: "var(--space-16)",
              padding: "18px 0",
              borderTop: `1px solid ${DIVIDER}`,
              borderBottom: `1px solid ${DIVIDER}`,
              marginTop: "var(--space-20)",
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
                <Skeleton width={54} height={10} />
                <Skeleton width={34} height={18} />
              </div>
            ))}
          </div>
          <Skeleton width={120} height={13} style={{ marginTop: "var(--space-20)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", marginTop: "var(--space-12)" }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-12)",
                  padding: "10px 0",
                  borderBottom: i === 4 ? "none" : `1px solid ${DIVIDER}`,
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
    </div>
  );
}

export function CharacterIngestionRedirectLoadingSkeleton() {
  return (
    <div style={{ ...shellStyle, background: "var(--background)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(320px, 460px)",
          gap: 40,
          padding: "32px 32px 56px",
          alignItems: "flex-start",
        }}
      >
        <div style={{ ...panelStyle, background: "var(--card)", padding: "var(--space-24)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
            <Skeleton width={118} height={10} radius={3} />
            <div style={{ flex: 1 }} />
            <Skeleton width={104} height={28} radius={0} static />
          </div>
          <Skeleton width="48%" height={30} style={{ marginTop: 22 }} />
          <SkeletonText lines={3} lineHeight={13} gap={8} style={{ marginTop: "var(--space-14)" }} />
          <div
            style={{
              minHeight: 360,
              border: `1px solid ${BORDER}`,
              background: "rgba(255,255,255,0.02)",
              marginTop: "var(--space-24)",
              padding: "var(--space-18)",
            }}
          >
            <SkeletonText lines={9} lineHeight={13} gap={11} lastLineWidth="40%" />
          </div>
          <div style={{ display: "flex", gap: "var(--space-10)", marginTop: "var(--space-18)" }}>
            {[96, 118, 84].map((w) => (
              <Skeleton key={w} width={w} height={28} radius={0} static />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-24)", position: "sticky", top: 24 }}>
          <div style={{ ...panelStyle, background: "var(--card)", height: 300, padding: "var(--space-18)" }}>
            <Skeleton width={120} height={12} />
            <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <GraphConstellationSkeleton />
            </div>
          </div>
          <div style={{ ...panelStyle, background: "var(--card)", padding: "var(--space-18)" }}>
            <Skeleton width={132} height={13} />
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", marginTop: "var(--space-16)" }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} width={`${88 - i * 8}%`} height={12} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
