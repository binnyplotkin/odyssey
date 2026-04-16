/* ── Kanban Board — Types & Data ─────────────────────────────── */

export type TicketStatus = "backlog" | "todo" | "in-progress" | "review" | "done";

export type TicketDomain =
  | "research"
  | "voice"
  | "engine"
  | "data"
  | "frontend"
  | "world"
  | "infra"
  | "design";

export type TicketPriority = "P1" | "P2" | "P3";

export type Subtask = {
  id: string;
  label: string;
  done: boolean;
};

export type ActivityItem = {
  id: string;
  author: string;
  authorColor: string;
  timestamp: string;
  text: string;
  type: "comment" | "system";
};

export type Ticket = {
  id: string;
  title: string;
  description?: string;
  status: TicketStatus;
  domain?: TicketDomain;
  priority?: TicketPriority;
  assignee?: string;
  phase?: string;
  featureId?: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  subtasks?: Subtask[];
  activity?: ActivityItem[];
};

export type Column = {
  id: TicketStatus;
  label: string;
  dotColor: string;
};

/* ── Columns ─────────────────────────────────────────────────── */

export const COLUMNS: Column[] = [
  { id: "backlog", label: "Backlog", dotColor: "#64748B" },
  { id: "todo", label: "To Do", dotColor: "#3B82F6" },
  { id: "in-progress", label: "In Progress", dotColor: "#3B82F6" },
  { id: "review", label: "Review", dotColor: "#F59E0B" },
  { id: "done", label: "Done", dotColor: "#22C55E" },
];

/* ── Domain tag colors ───────────────────────────────────────── */

export const DOMAIN_COLORS: Record<TicketDomain, { color: string; bg: string }> = {
  research: { color: "#8B7EB5", bg: "rgba(139, 126, 192, 0.1)" },
  voice: { color: "#C8875A", bg: "rgba(200, 136, 90, 0.1)" },
  engine: { color: "#5B7FB5", bg: "rgba(91, 127, 181, 0.1)" },
  data: { color: "#C45C5C", bg: "rgba(196, 92, 92, 0.1)" },
  frontend: { color: "#5B7FB5", bg: "rgba(91, 127, 181, 0.1)" },
  world: { color: "#5A9E82", bg: "rgba(90, 158, 130, 0.1)" },
  infra: { color: "#8B7EB5", bg: "rgba(139, 126, 192, 0.1)" },
  design: { color: "#8B7EB5", bg: "rgba(139, 126, 192, 0.1)" },
};

/* ── Priority corner-dot colors ──────────────────────────────── */

export const PRIORITY_DOT: Record<TicketPriority, string> = {
  P1: "#EF4444",
  P2: "#F59E0B",
  P3: "#64748B",
};

