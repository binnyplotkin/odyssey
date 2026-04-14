/* ── Roadmap client helpers ──────────────────────────────────── */

import type { GanttVersion, GanttTask, GanttTicket } from "@/data/gantt";

/* Types matching the /api/roadmap response */

export type RoadmapTicket = {
  id: string;
  title: string;
  status: string;
  domain: string | null;
  priority: string | null;
  startDate: string | null;
  endDate: string | null;
};

export type RoadmapFeature = {
  id: string;
  versionId: string;
  title: string;
  description: string | null;
  color: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  ticketCount: number;
  doneTicketCount: number;
  tickets?: RoadmapTicket[];
};

export type RoadmapVersion = {
  id: string;
  tag: string;
  title: string;
  description: string | null;
  color: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  features: RoadmapFeature[];
};

/* ── Color helpers ───────────────────────────────────────────── */

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ── Record → Gantt mappers ─────────────────────────────────── */

export function ticketToGanttTicket(t: RoadmapTicket, featureColor: string): GanttTicket {
  return {
    id: t.id,
    label: t.title,
    start: t.startDate ?? "",
    end: t.endDate ?? "",
    color: hexToRgba(featureColor, 0.2),
    borderColor: hexToRgba(featureColor, 0.35),
  };
}

export function featureToGanttTask(f: RoadmapFeature, versionColor: string): GanttTask {
  const baseColor = f.color ?? versionColor;
  return {
    id: f.id,
    label: f.title,
    start: f.startDate ?? "",
    end: f.endDate ?? "",
    color: hexToRgba(baseColor, 0.3),
    borderColor: hexToRgba(baseColor, 0.5),
    tickets: (f.tickets ?? [])
      .filter((t) => t.startDate && t.endDate)
      .map((t) => ticketToGanttTicket(t, baseColor)),
  };
}

export function versionToGantt(v: RoadmapVersion): GanttVersion {
  return {
    id: v.id,
    tag: v.tag,
    title: v.title,
    color: v.color,
    barBg: hexToRgba(v.color, 0.12),
    barBorder: hexToRgba(v.color, 0.25),
    start: v.startDate ?? "",
    end: v.endDate ?? "",
    tasks: v.features.map((f) => featureToGanttTask(f, v.color)),
  };
}

/* ── Timeline range from version data ────────────────────────── */

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isValidDate(d: string | null): d is string {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime());
}

export function computeTimelineRange(versions: RoadmapVersion[]) {
  let minDate = "9999-12-31";
  let maxDate = "0000-01-01";

  for (const v of versions) {
    if (isValidDate(v.startDate) && v.startDate < minDate) minDate = v.startDate;
    if (isValidDate(v.endDate) && v.endDate > maxDate) maxDate = v.endDate;
    for (const f of v.features) {
      if (isValidDate(f.startDate) && f.startDate < minDate) minDate = f.startDate;
      if (isValidDate(f.endDate) && f.endDate > maxDate) maxDate = f.endDate;
      for (const t of f.tickets ?? []) {
        if (isValidDate(t.startDate) && t.startDate < minDate) minDate = t.startDate;
        if (isValidDate(t.endDate) && t.endDate > maxDate) maxDate = t.endDate;
      }
    }
  }

  // Expand to month boundaries
  const startD = new Date(minDate);
  const start = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, "0")}-01`;

  const endD = new Date(maxDate);
  endD.setMonth(endD.getMonth() + 1);
  const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-01`;

  // Build month array
  const months: Array<{ label: string; start: string }> = [];
  const cursor = new Date(start);
  const endTime = new Date(end).getTime();
  while (cursor.getTime() < endTime) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    months.push({
      label: `${MONTH_LABELS[m]} ${y}`,
      start: `${y}-${String(m + 1).padStart(2, "0")}-01`,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return { timelineStart: start, timelineEnd: end, months };
}
