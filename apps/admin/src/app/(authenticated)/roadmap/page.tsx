import { getVersionStore, getFeatureStore, getTicketStore } from "@odyssey/db";
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
        const featureTickets = (ticketsByFeature.get(f.id) ?? []).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          domain: t.domain,
          priority: t.priority,
          startDate: t.startDate,
          endDate: t.endDate,
        }));
        return { ...f, ticketCount: counts.total, doneTicketCount: counts.done, tickets: featureTickets };
      });
    return { ...v, features };
  });
}

export default async function RoadmapPage() {
  const versions = await loadRoadmap();
  return <RoadmapClient versions={versions} />;
}
