import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--material-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-xl)",
};

export default function DashboardLoading() {
  return (
    <div
      style={{
        padding: "24px 28px",
        width: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* ── Top row: stat grid + activity heatmap ────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-16)",
          marginBottom: "var(--space-24)",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
          {[0, 1].map((row) => (
            <div key={row} style={{ display: "flex", gap: "var(--space-10)" }}>
              {[0, 1].map((col) => (
                <div key={col} style={{ ...CARD, padding: "16px 20px", flex: 1 }}>
                  <Skeleton width={64} height={10} style={{ marginBottom: "var(--space-8)" }} />
                  <Skeleton width={84} height={28} style={{ marginBottom: "var(--space-6)" }} />
                  <Skeleton width={48} height={11} />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Activity card */}
        <div
          style={{
            ...CARD,
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-12)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-12)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <Skeleton width={60} height={13} />
              <Skeleton width={140} height={11} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--space-18)", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              {/* Day labels row */}
              <div style={{ display: "flex", gap: "var(--space-4)" }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} style={{ width: 24, display: "flex", justifyContent: "center" }}>
                    <Skeleton width={8} height={9} />
                  </div>
                ))}
              </div>
              {/* Heatmap rows */}
              {Array.from({ length: 5 }).map((_, w) => (
                <div key={w} style={{ display: "flex", gap: "var(--space-4)" }}>
                  {Array.from({ length: 7 }).map((_, d) => (
                    <Skeleton key={d} width={24} height={24} radius={3} static />
                  ))}
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-14)",
                paddingLeft: "var(--space-18)",
                borderLeft: "1px solid var(--border-subtle)",
                paddingTop: "var(--space-14)",
                minWidth: 100,
              }}
            >
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                  <Skeleton width={56} height={10} />
                  <Skeleton width={i === 0 ? 36 : 80} height={i === 0 ? 18 : 13} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section header: Version Progress ─────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-12)",
        }}
      >
        <Skeleton width={120} height={11} />
        <Skeleton width={70} height={11} />
      </div>

      {/* ── Version cards ────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)", marginBottom: 28 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ ...CARD, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", marginBottom: "var(--space-10)" }}>
              <Skeleton width={48} height={13} />
              <Skeleton width={180} height={13} style={{ flex: "0 1 180px" }} />
              <div style={{ flex: 1 }} />
              <Skeleton width={64} height={18} radius={999} />
            </div>
            <Skeleton width="100%" height={6} radius={3} />
            <div style={{ display: "flex", gap: "var(--space-8)", marginTop: "var(--space-12)" }}>
              {Array.from({ length: 3 }).map((__, j) => (
                <Skeleton key={j} width={120} height={24} radius={6} static />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Bottom split: changelog + docs ───────────────────────── */}
      <div style={{ display: "flex", gap: "var(--space-16)", flexWrap: "wrap" }}>
        {[0, 1].map((col) => (
          <div key={col} style={{ flex: 1, minWidth: 320 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--space-12)",
              }}
            >
              <Skeleton width={90} height={11} />
              <Skeleton width={70} height={11} />
            </div>
            <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-12)",
                    padding: "12px 14px",
                    borderBottom:
                      i === 4 ? "none" : "1px solid var(--border-subtle)",
                  }}
                >
                  <Skeleton width={56} height={18} radius={999} static />
                  <Skeleton width="60%" height={13} />
                  <div style={{ flex: 1 }} />
                  <Skeleton width={40} height={11} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
