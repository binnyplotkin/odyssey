import { Skeleton } from "@odyssey/ui";

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: "var(--radius-xl)",
};

const COLS = ["Email", "Role", "Auth", "Sessions", "Last active", "Created"];

export default function UsersLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Skeleton width={120} height={20} />
        <Skeleton width={140} height={28} radius={8} />
      </div>

      <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px,2fr) 100px 120px 100px 140px 140px",
            padding: "12px 16px",
            borderBottom: "1px solid var(--card-border)",
            background: "var(--panel)",
          }}
        >
          {COLS.map((c) => (
            <Skeleton key={c} width={Math.max(48, c.length * 6)} height={11} static />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px,2fr) 100px 120px 100px 140px 140px",
              alignItems: "center",
              padding: "14px 16px",
              borderBottom: i === 7 ? "none" : "1px solid var(--card-border)",
              gap: "var(--space-12)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
              <Skeleton width={28} height={28} variant="circle" />
              <Skeleton width="70%" height={13} />
            </div>
            <Skeleton width={56} height={18} radius={999} static />
            <div style={{ display: "flex", gap: "var(--space-4)" }}>
              <Skeleton width={18} height={18} variant="circle" static />
              <Skeleton width={18} height={18} variant="circle" static />
            </div>
            <Skeleton width={32} height={13} />
            <Skeleton width={84} height={12} />
            <Skeleton width={84} height={12} />
          </div>
        ))}
      </div>
    </div>
  );
}
