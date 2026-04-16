import { eq } from "drizzle-orm";
import { getVersionStore, getFeatureStore, getTicketStore, getDb, usersTable } from "@odyssey/db";
import type { RoadmapVersion } from "@/lib/roadmap";
import RoadmapClient from "./roadmap-client";

export const dynamic = "force-dynamic";

async function loadRoadmap(): Promise<RoadmapVersion[]> {
  const [allVersions, allFeatures, allTickets] = await Promise.all([
    getVersionStore().list(),
    getFeatureStore().list(),
    getTicketStore().list(),
  ]);

  // Group tickets by featureId
  const ticketsByFeature = new Map<string, typeof allTickets>();
  const ticketCounts = new Map<string, { total: number; done: number }>();
  for (const t of allTickets) {
    if (!t.featureId) continue;
    const list = ticketsByFeature.get(t.featureId) ?? [];
    list.push(t);
    ticketsByFeature.set(t.featureId, list);
    const entry = ticketCounts.get(t.featureId) ?? { total: 0, done: 0 };
    entry.total++;
    if (t.status === "done") entry.done++;
    ticketCounts.set(t.featureId, entry);
  }

  return allVersions.map((v) => {
    const features = allFeatures
      .filter((f) => f.versionId === v.id)
      .map((f) => {
        const counts = ticketCounts.get(f.id) ?? { total: 0, done: 0 };
        const featureTickets = (ticketsByFeature.get(f.id) ?? [])
          .sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            domain: t.domain,
            priority: t.priority,
            assignee: t.assignee,
            sortOrder: t.sortOrder,
            startDate: t.startDate,
            endDate: t.endDate,
          }));
        return { ...f, ticketCount: counts.total, doneTicketCount: counts.done, tickets: featureTickets };
      });
    return { ...v, features };
  });
}

async function loadTeam(): Promise<{ id: string; name: string; email: string; image: string | null }[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, image: usersTable.image })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));
    return rows.map((r) => ({ id: r.id, name: r.name ?? r.email, email: r.email, image: r.image }));
  } catch {
    return [];
  }
}

export default async function RoadmapPage() {
  const [versions, team] = await Promise.all([loadRoadmap(), loadTeam()]);
  return <RoadmapClient versions={versions} team={team} />;
}
