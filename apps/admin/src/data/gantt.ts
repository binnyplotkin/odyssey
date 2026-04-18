/* ── Gantt View — Types ──────────────────────────────────────── */

export type GanttTicket = {
  id: string;
  label: string;
  start: string;   // ISO date, e.g. "2026-03-15"
  end: string;
  color: string;
  borderColor: string;
  status?: string;
};

export type GanttTask = {
  id: string;
  label: string;
  start: string;   // ISO date, e.g. "2026-03-15"
  end: string;
  color: string;
  borderColor: string;
  tickets?: GanttTicket[];
};

export type GanttVersion = {
  id: string;
  tag: string;          // e.g. "v0.1"
  title: string;
  color: string;
  barBg: string;
  barBorder: string;
  start: string;
  end: string;
  collapsed?: boolean;
  tasks: GanttTask[];
};
