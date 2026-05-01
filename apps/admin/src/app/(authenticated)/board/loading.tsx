import { Skeleton } from "@odyssey/ui";

const COLUMN: React.CSSProperties = {
  flex: 1,
  minWidth: 280,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const TICKET: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: 10,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const COLUMN_TICKET_COUNTS = [4, 3, 2, 3];

export default function BoardLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Skeleton width={100} height={20} />
        <div style={{ display: "flex", gap: 8 }}>
          <Skeleton width={28} height={28} variant="circle" />
          <Skeleton width={28} height={28} variant="circle" />
          <Skeleton width={28} height={28} variant="circle" />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        {COLUMN_TICKET_COUNTS.map((tickets, ci) => (
          <div key={ci} style={COLUMN}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
              <Skeleton width={8} height={8} variant="circle" static />
              <Skeleton width={72} height={11} />
              <div style={{ flex: 1 }} />
              <Skeleton width={20} height={14} />
            </div>
            {Array.from({ length: tickets }).map((_, i) => (
              <div key={i} style={TICKET}>
                <Skeleton width="90%" height={13} />
                <Skeleton width="65%" height={12} />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Skeleton width={48} height={16} radius={999} static />
                  <Skeleton width={32} height={16} radius={999} static />
                  <div style={{ flex: 1 }} />
                  <Skeleton width={20} height={20} variant="circle" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
