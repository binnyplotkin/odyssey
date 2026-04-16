const typeStyles: Record<string, { bg: string; border: string; accent: string; label: string }> = {
  "info": {
    bg: "rgba(96,165,250,0.06)",
    border: "rgba(96,165,250,0.15)",
    accent: "#60a5fa",
    label: "Info",
  },
  "warning": {
    bg: "rgba(251,191,36,0.06)",
    border: "rgba(251,191,36,0.15)",
    accent: "#fbbf24",
    label: "Heads up",
  },
  "important": {
    bg: "rgba(143,209,203,0.06)",
    border: "rgba(143,209,203,0.15)",
    accent: "var(--accent)",
    label: "Important",
  },
  "tip": {
    bg: "rgba(52,211,153,0.06)",
    border: "rgba(52,211,153,0.15)",
    accent: "#34d399",
    label: "Tip",
  },
};

export function Callout({
  children,
  type = "info",
  title,
}: {
  children: React.ReactNode;
  type?: string;
  title?: string;
}) {
  const style = typeStyles[type] ?? typeStyles["info"];

  return (
    <div style={{
      padding: "12px 16px",
      borderRadius: 8,
      background: style.bg,
      borderLeft: `3px solid ${style.accent}`,
      margin: "12px 0",
      fontSize: "0.8125rem",
      lineHeight: 1.6,
    }}>
      {(title || style.label) && (
        <div style={{
          fontWeight: 600,
          fontSize: "0.75rem",
          color: style.accent,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}>
          {title ?? style.label}
        </div>
      )}
      <div style={{ color: "var(--foreground)" }}>
        {children}
      </div>
    </div>
  );
}
