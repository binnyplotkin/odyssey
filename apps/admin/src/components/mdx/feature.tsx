import { getFeatureStore, getTicketStore } from "@odyssey/db";

const statusStyles: Record<string, { bg: string; text: string; dot: string }> = {
  "planned": { bg: "rgba(255,255,255,0.06)", text: "var(--text-tertiary)", dot: "var(--text-tertiary)" },
  "active": { bg: "rgba(96,165,250,0.12)", text: "#93bbfc", dot: "#60a5fa" },
  "done": { bg: "rgba(52,211,153,0.12)", text: "#34d399", dot: "#34d399" },
};

// Map ticket statuses to feature-level statuses
const ticketStatusMap: Record<string, string> = {
  "backlog": "planned",
  "todo": "planned",
  "in-progress": "active",
  "review": "active",
  "done": "done",
};

export async function Feature({
  children,
  status,
  version,
  featureId,
  ticketId,
}: {
  children?: React.ReactNode;
  status?: string;
  version?: string;
  featureId?: string;
  ticketId?: string;
}) {
  let resolvedStatus = status ?? "planned";
  let label = children;

  // Live-link to a feature in the DB
  if (featureId) {
    try {
      const feature = await getFeatureStore().getById(featureId);
      if (feature) {
        resolvedStatus = feature.status;
        if (!children) label = feature.title;
      }
    } catch { /* fall back to static */ }
  }

  // Live-link to a ticket in the DB
  if (ticketId) {
    try {
      const ticket = await getTicketStore().getById(ticketId);
      if (ticket) {
        resolvedStatus = ticketStatusMap[ticket.status] ?? "planned";
        if (!children) label = ticket.title;
      }
    } catch { /* fall back to static */ }
  }

  const style = statusStyles[resolvedStatus] ?? statusStyles["planned"];

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-6)",
      padding: "3px 10px",
      borderRadius: "var(--radius-pill)",
      background: style.bg,
      color: style.text,
      fontSize: "0.75rem",
      fontWeight: 500,
      lineHeight: 1,
      verticalAlign: "middle",
    }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: style.dot,
        flexShrink: 0,
      }} />
      {label}
      {version && (
        <span style={{
          opacity: 0.6,
          fontSize: "0.6875rem",
        }}>
          {version}
        </span>
      )}
    </span>
  );
}
