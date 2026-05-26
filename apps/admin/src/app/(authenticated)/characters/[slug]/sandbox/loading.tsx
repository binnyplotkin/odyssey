import { Skeleton } from "@odyssey/ui";

export default function SandboxLoading() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 380px",
        background: "var(--background)",
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        color: "var(--text-primary)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage:
            "linear-gradient(var(--grid-color) 1px, transparent 1px), linear-gradient(90deg, var(--grid-color) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      >
        <div
          style={{
            width: 520,
            border: "1px solid var(--border)",
            background: "var(--card)",
            padding: "var(--space-24)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-18)",
          }}
        >
          <Skeleton width={128} height={10} radius={3} />
          <Skeleton width="66%" height={30} radius={4} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-12)" }}>
            <Skeleton width="100%" height={84} radius={0} />
            <Skeleton width="100%" height={84} radius={0} />
          </div>
          <Skeleton width="100%" height={42} radius={0} static />
        </div>
        <div
          style={{
            position: "absolute",
            left: 24,
            right: 24,
            bottom: 22,
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "var(--space-10)",
          }}
        >
          {[90, 118, 96, 74].map((w, i) => (
            <div
              key={i}
              style={{
                border: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--background) 70%, transparent)",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-6)",
              }}
            >
              <Skeleton width={w} height={10} radius={3} />
              <Skeleton width="60%" height={15} radius={3} />
            </div>
          ))}
        </div>
      </div>
      <aside
        style={{
          borderLeft: "1px solid var(--border)",
          background: "rgba(255,255,255,0.02)",
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
          <Skeleton width={48} height={48} radius={0} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <Skeleton width="60%" height={16} />
            <Skeleton width="42%" height={10} />
          </div>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border)",
              background: "var(--card)",
              padding: "var(--space-14)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-8)",
            }}
          >
            <Skeleton width={`${64 - i * 6}%`} height={13} />
            <Skeleton width="86%" height={11} />
            <Skeleton width="62%" height={11} />
          </div>
        ))}
      </aside>
    </div>
  );
}
