import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

export default function CharacterWikiLoading() {
  return (
    <div style={{ display: "flex", gap: 16, height: "100%" }}>
      {/* Left: graph */}
      <div
        style={{
          ...CARD,
          flex: 1,
          minWidth: 0,
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
          {/* Constellation of "nodes" + center hub */}
          <div style={{ position: "relative", width: 360, height: 360 }}>
            {[
              { top: 20, left: 60 },
              { top: 40, left: 240 },
              { top: 130, left: 0 },
              { top: 130, left: 320 },
              { top: 240, left: 60 },
              { top: 270, left: 240 },
              { top: 160, left: 160 },
            ].map((pos, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: pos.top,
                  left: pos.left,
                  width: i === 6 ? 56 : 40,
                  height: i === 6 ? 56 : 40,
                }}
              >
                <Skeleton width="100%" height="100%" variant="circle" />
              </div>
            ))}
          </div>
        </div>

        {/* Top bar overlay */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 14,
            right: 14,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Skeleton width={120} height={26} radius={8} />
          <div style={{ flex: 1 }} />
          <Skeleton width={28} height={26} radius={6} />
          <Skeleton width={28} height={26} radius={6} />
        </div>
      </div>

      {/* Right: detail panel */}
      <div
        style={{
          ...CARD,
          width: 380,
          flexShrink: 0,
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Skeleton width={32} height={32} variant="circle" />
          <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
            <Skeleton width="60%" height={14} />
            <Skeleton width={88} height={10} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <Skeleton width="100%" height={12} />
          <Skeleton width="92%" height={12} />
          <Skeleton width="80%" height={12} />
          <Skeleton width="64%" height={12} />
        </div>
        <div
          style={{
            paddingTop: 12,
            borderTop: "1px solid var(--card-border)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <Skeleton width={100} height={11} />
          {Array.from({ length: 3 }).map((_, i) => (
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
