import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import {
  getVersionStore,
  getFeatureStore,
  getTicketStore,
  getChangelogStore,
} from "@odyssey/db";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

const ACTIVITY_WINDOW_DAYS = 30;

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildActivityData(
  tickets: Array<{ activity: unknown }>,
  changelog: Array<{ createdAt: string }>,
  docs: Array<{ updatedAt: string }>,
) {
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const windowStart = new Date(todayEnd);
  windowStart.setDate(windowStart.getDate() - (ACTIVITY_WINDOW_DAYS - 1));
  windowStart.setHours(0, 0, 0, 0);

  const counts = new Map<string, number>();
  const bump = (iso: string) => {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t < windowStart.getTime() || t > todayEnd.getTime()) return;
    const key = dayKey(new Date(t));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const entry of changelog) bump(entry.createdAt);
  for (const doc of docs) bump(doc.updatedAt);
  for (const ticket of tickets) {
    const items = Array.isArray(ticket.activity) ? ticket.activity : [];
    for (const item of items) {
      const ts = (item as { timestamp?: unknown }).timestamp;
      if (typeof ts === "string") bump(ts);
    }
  }

  // Pad grid to Sunday-start through Saturday-end for calendar layout
  const gridStart = new Date(windowStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(todayEnd);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  type DayCell = { date: string; count: number; inWindow: boolean; isToday: boolean; isFuture: boolean };
  const days: DayCell[] = [];
  const todayKey = dayKey(now);
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d);
    const inWindow = d >= windowStart && d <= todayEnd;
    const isFuture = d.getTime() > todayEnd.getTime();
    days.push({
      date: key,
      count: inWindow ? counts.get(key) ?? 0 : 0,
      inWindow,
      isToday: key === todayKey,
      isFuture,
    });
  }

  const windowDays = days.filter((d) => d.inWindow);
  const totalEvents = windowDays.reduce((sum, d) => sum + d.count, 0);
  const avgPerDay = windowDays.length > 0 ? totalEvents / windowDays.length : 0;

  let peakDay: DayCell | null = null;
  for (const d of windowDays) {
    if (!peakDay || d.count > peakDay.count) peakDay = d;
  }

  let streak = 0;
  for (let i = windowDays.length - 1; i >= 0; i--) {
    if (windowDays[i].count > 0) streak++;
    else break;
  }

  const todayCount = counts.get(todayKey) ?? 0;

  return {
    days,
    totalEvents,
    avgPerDay: Math.round(avgPerDay * 10) / 10,
    peakDay: peakDay && peakDay.count > 0 ? { date: peakDay.date, count: peakDay.count } : null,
    streak,
    todayCount,
    windowDays: ACTIVITY_WINDOW_DAYS,
  };
}

async function loadDocs() {
  const docsDir = path.resolve(process.cwd(), "../../docs");
  try {
    const files = await fs.readdir(docsDir);
    const docs = await Promise.all(
      files
        .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"))
        .map(async (f) => {
          const id = f.replace(/\.mdx?$/, "");
          const raw = await fs.readFile(path.join(docsDir, f), "utf-8");
          const { data: frontmatter, content } = matter(raw);
          const firstLine = content.split("\n").find((l) => l.startsWith("# "));
          const title = (frontmatter.title as string) || (firstLine ? firstLine.replace(/^#\s+/, "") : id);
          const stat = await fs.stat(path.join(docsDir, f));
          return { id, title, updatedAt: stat.mtime.toISOString() };
        }),
    );
    docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return docs;
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const [versions, features, tickets, changelog, docs] = await Promise.all([
    getVersionStore().list(),
    getFeatureStore().list(),
    getTicketStore().list(),
    getChangelogStore().list(),
    loadDocs(),
  ]);

  // Build version summaries with feature/ticket rollups
  const versionSummaries = versions.map((v) => {
    const vFeatures = features.filter((f) => f.versionId === v.id);
    const vTicketIds = new Set(vFeatures.map((f) => f.id));
    const vTickets = tickets.filter((t) => t.featureId && vTicketIds.has(t.featureId));
    const doneTickets = vTickets.filter((t) => t.status === "done").length;
    return {
      id: v.id,
      tag: v.tag,
      title: v.title,
      color: v.color,
      status: v.status,
      startDate: v.startDate,
      endDate: v.endDate,
      featureCount: vFeatures.length,
      features: vFeatures.map((f) => {
        const fTickets = tickets.filter((t) => t.featureId === f.id);
        const fDone = fTickets.filter((t) => t.status === "done").length;
        return {
          id: f.id,
          title: f.title,
          status: f.status,
          color: f.color ?? v.color,
          ticketCount: fTickets.length,
          doneTicketCount: fDone,
        };
      }),
      ticketCount: vTickets.length,
      doneTicketCount: doneTickets,
    };
  });

  // Ticket breakdowns
  const ticketsByStatus: Record<string, number> = {};
  const ticketsByDomain: Record<string, number> = {};
  const ticketsByPriority: Record<string, number> = {};
  for (const t of tickets) {
    ticketsByStatus[t.status] = (ticketsByStatus[t.status] ?? 0) + 1;
    if (t.domain) ticketsByDomain[t.domain] = (ticketsByDomain[t.domain] ?? 0) + 1;
    if (t.priority) ticketsByPriority[t.priority] = (ticketsByPriority[t.priority] ?? 0) + 1;
  }

  const activityData = buildActivityData(tickets, changelog, docs);

  return (
    <DashboardClient
      versions={versionSummaries}
      totalFeatures={features.length}
      totalTickets={tickets.length}
      openTickets={tickets.filter((t) => t.status !== "done").length}
      ticketsByStatus={ticketsByStatus}
      ticketsByDomain={ticketsByDomain}
      ticketsByPriority={ticketsByPriority}
      recentChangelog={changelog.slice(0, 8)}
      docs={docs}
      activity={activityData}
    />
  );
}
