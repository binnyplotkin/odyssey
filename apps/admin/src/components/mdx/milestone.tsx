import { getTicketStore } from "@odyssey/db";

const phaseColors: Record<string, string> = {
  done: "#34d399",
  active: "#fbbf24",
  planned: "#93bbfc",
};

export async function Milestone({
  title,
  ticketIds,
}: {
  title: string;
  ticketIds: string | string[];
}) {
  const ids = Array.isArray(ticketIds)
    ? ticketIds
    : typeof ticketIds === "string"
      ? ticketIds.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  const store = getTicketStore();
  const tickets = await Promise.all(
    ids.map(async (id) => {
      try {
        return await store.getById(id);
      } catch {
        return null;
      }
    })
  );

  const valid = tickets.filter(Boolean) as Exclude<(typeof tickets)[number], null>[];
  const total = valid.length;
  const done = valid.filter((t) => t.status === "done").length;
  const inProgress = valid.filter((t) => t.status === "in-progress" || t.status === "review").length;
  const planned = total - done - inProgress;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const overallStatus = done === total ? "done" : inProgress > 0 || done > 0 ? "active" : "planned";
  const accentColor = phaseColors[overallStatus];

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      background: "var(--surface-1)",
      padding: "16px 18px",
      margin: "12px 0",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "var(--space-12)",
      }}>
        <span style={{
          fontWeight: 600,
          fontSize: "0.875rem",
          color: "var(--foreground)",
        }}>
          {title}
        </span>
        <span style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          color: accentColor,
        }}>
          {done}/{total} done
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 6,
        borderRadius: "var(--radius-xs)",
        background: "rgba(255,255,255,0.06)",
        overflow: "hidden",
        display: "flex",
        marginBottom: "var(--space-14)",
      }}>
        {done > 0 && (
          <div style={{
            width: `${(done / total) * 100}%`,
            background: "#34d399",
            borderRadius: "3px 0 0 3px",
            transition: "width 300ms",
          }} />
        )}
        {inProgress > 0 && (
          <div style={{
            width: `${(inProgress / total) * 100}%`,
            background: "#fbbf24",
            transition: "width 300ms",
          }} />
        )}
      </div>

      {/* Ticket list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        {valid.map((ticket) => {
          const statusIcon = ticket.status === "done" ? "\u2713"
            : (ticket.status === "in-progress" || ticket.status === "review") ? "\u25C9"
            : "\u25CB";
          const statusColor = ticket.status === "done" ? "#34d399"
            : (ticket.status === "in-progress" || ticket.status === "review") ? "#fbbf24"
            : "var(--text-tertiary)";

          return (
            <div
              key={ticket.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-8)",
                fontSize: "0.8125rem",
              }}
            >
              <span style={{
                color: statusColor,
                fontWeight: 700,
                fontSize: "0.75rem",
                width: 16,
                textAlign: "center",
                flexShrink: 0,
              }}>
                {statusIcon}
              </span>
              <span style={{
                color: ticket.status === "done" ? "var(--text-tertiary)" : "var(--foreground)",
                textDecoration: ticket.status === "done" ? "line-through" : "none",
                opacity: ticket.status === "done" ? 0.7 : 1,
                flex: 1,
              }}>
                {ticket.title}
              </span>
              <span style={{
                fontSize: "0.6875rem",
                color: statusColor,
                fontWeight: 500,
                flexShrink: 0,
              }}>
                {ticket.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
