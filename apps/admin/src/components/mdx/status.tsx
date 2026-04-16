import { getTicketStore } from "@odyssey/db";

const typeStyles: Record<string, { bg: string; border: string; icon: string; color: string }> = {
  "done": {
    bg: "rgba(52,211,153,0.08)",
    border: "rgba(52,211,153,0.2)",
    icon: "\u2713",
    color: "#34d399",
  },
  "in-progress": {
    bg: "rgba(251,191,36,0.08)",
    border: "rgba(251,191,36,0.2)",
    icon: "\u25C9",
    color: "#fbbf24",
  },
  "blocked": {
    bg: "rgba(248,113,113,0.08)",
    border: "rgba(248,113,113,0.2)",
    icon: "\u2715",
    color: "#f87171",
  },
  "planned": {
    bg: "rgba(96,165,250,0.08)",
    border: "rgba(96,165,250,0.2)",
    icon: "\u25CB",
    color: "#93bbfc",
  },
};

// Map ticket statuses to Status block types
const ticketTypeMap: Record<string, string> = {
  "backlog": "planned",
  "todo": "planned",
  "in-progress": "in-progress",
  "review": "in-progress",
  "done": "done",
};

export async function Status({
  children,
  type,
  ticketId,
}: {
  children?: React.ReactNode;
  type?: string;
  ticketId?: string;
}) {
  let resolvedType = type ?? "planned";
  let label = children;

  // Live-link to a ticket in the DB
  if (ticketId) {
    try {
      const ticket = await getTicketStore().getById(ticketId);
      if (ticket) {
        resolvedType = ticketTypeMap[ticket.status] ?? "planned";
        if (!children) label = ticket.title;
      }
    } catch { /* fall back to static */ }
  }

  const style = typeStyles[resolvedType] ?? typeStyles["planned"];

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      padding: "10px 14px",
      borderRadius: 8,
      background: style.bg,
      border: `1px solid ${style.border}`,
      margin: "8px 0",
      fontSize: "0.8125rem",
      lineHeight: 1.5,
    }}>
      <span style={{
        color: style.color,
        fontWeight: 700,
        fontSize: "0.875rem",
        lineHeight: "1.3",
        flexShrink: 0,
      }}>
        {style.icon}
      </span>
      <span style={{ color: "var(--foreground)" }}>
        {label}
      </span>
    </div>
  );
}
