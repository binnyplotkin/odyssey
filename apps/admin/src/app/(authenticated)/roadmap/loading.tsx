import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 12,
};

const BAR_LANES = [
  { offset: 0, width: 30 },
  { offset: 22, width: 36 },
  { offset: 12, width: 50 },
  { offset: 40, width: 28 },
  { offset: 8, width: 44 },
  { offset: 30, width: 38 },
  { offset: 18, width: 56 },
];

export default function RoadmapLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      {/* Header: tabs + actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[64, 76, 64].map((w, i) => (
            <Skeleton key={i} width={w} height={28} radius={8} static />
          ))}
        </div>
        <Skeleton width={140} height={28} radius={8} />
      </div>

      {/* Gantt frame */}
      <div style={{ ...CARD, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Time axis */}
        <div style={{ display: "flex", gap: 10, paddingLeft: 160 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width={64} height={11} static />
          ))}
        </div>

        {/* Lanes */}
        {BAR_LANES.map((lane, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Skeleton width={140} height={13} />
            <div
              style={{
                position: "relative",
                flex: 1,
                height: 24,
                background: "var(--panel)",
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  bottom: 4,
                  left: `${lane.offset}%`,
                  width: `${lane.width}%`,
                }}
              >
                <Skeleton width="100%" height="100%" radius={4} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
