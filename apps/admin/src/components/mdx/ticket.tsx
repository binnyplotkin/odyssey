import { getTicketStore } from "@odyssey/db";

const statusColors: Record<string, { bg: string; text: string }> = {
  "backlog": { bg: "rgba(255,255,255,0.06)", text: "var(--muted)" },
  "todo": { bg: "rgba(96,165,250,0.12)", text: "#93bbfc" },
  "in-progress": { bg: "rgba(251,191,36,0.12)", text: "#fbbf24" },
  "review": { bg: "rgba(168,85,247,0.12)", text: "#c084fc" },
  "done": { bg: "rgba(52,211,153,0.12)", text: "#34d399" },
};

const priorityColors: Record<string, { bg: string; text: string }> = {
  "P1": { bg: "rgba(248,113,113,0.15)", text: "#f87171" },
  "P2": { bg: "rgba(251,191,36,0.12)", text: "#fbbf24" },
  "P3": { bg: "rgba(255,255,255,0.06)", text: "var(--muted)" },
};

export async function Ticket({ id }: { id: string }) {
  const store = getTicketStore();
  const ticket = await store.getById(id);

  if (!ticket) {
    return (
      <span style={{
        display: "inline-flex",
        padding: "2px 8px",
        borderRadius: "var(--radius-xs)",
        background: "rgba(248,113,113,0.1)",
        color: "#f87171",
        fontSize: "0.75rem",
      }}>
        Ticket not found: {id}
      </span>
    );
  }

  const status = statusColors[ticket.status] ?? statusColors["backlog"];
  const priority = ticket.priority ? priorityColors[ticket.priority] : null;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "var(--space-10)",
      padding: "10px 14px",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "var(--panel)",
      margin: "8px 0",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 500,
          fontSize: "0.8125rem",
          color: "var(--foreground)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {ticket.title}
        </div>
        {ticket.domain && (
          <div style={{ fontSize: "0.6875rem", color: "var(--muted)", marginTop: "var(--space-2)" }}>
            {ticket.domain}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexShrink: 0 }}>
        {priority && (
          <span style={{
            padding: "2px 6px",
            borderRadius: "var(--radius-xs)",
            fontSize: "0.6875rem",
            fontWeight: 600,
            background: priority.bg,
            color: priority.text,
          }}>
            {ticket.priority}
          </span>
        )}
        <span style={{
          padding: "2px 8px",
          borderRadius: "var(--radius-xs)",
          fontSize: "0.6875rem",
          fontWeight: 500,
          background: status.bg,
          color: status.text,
        }}>
          {ticket.status}
        </span>
      </div>
    </div>
  );
}
