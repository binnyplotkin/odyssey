export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)",
        padding: "1.25rem 1.5rem",
        minWidth: 160,
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--muted)",
          marginBottom: "0.25rem",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{value}</div>
      {detail && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--muted)",
            marginTop: "0.25rem",
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}
