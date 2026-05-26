import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: "var(--radius-2xl)",
  overflow: "hidden",
};

function DocCardSkeleton({ flip }: { flip: boolean }) {
  const gradient = (
    <div style={{ flex: 1, minHeight: 220, background: "var(--card-hover)" }} />
  );
  const text = (
    <div
      style={{
        flex: 1,
        padding: "24px 28px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        justifyContent: "center",
      }}
    >
      <Skeleton width={80} height={11} />
      <Skeleton width="80%" height={22} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", marginTop: "var(--space-4)" }}>
        <Skeleton width="100%" height={13} />
        <Skeleton width="92%" height={13} />
        <Skeleton width="64%" height={13} />
      </div>
    </div>
  );
  return (
    <div style={{ ...CARD, display: "flex", flexDirection: flip ? "row-reverse" : "row" }}>
      {gradient}
      {text}
    </div>
  );
}

export default function DocsLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Skeleton width={100} height={20} />
        <Skeleton width={120} height={28} radius={8} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <DocCardSkeleton key={i} flip={i % 2 === 1} />
        ))}
      </div>
    </div>
  );
}
