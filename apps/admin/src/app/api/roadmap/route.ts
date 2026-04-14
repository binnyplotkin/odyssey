import { NextResponse } from "next/server";
import { getVersionStore, getFeatureStore, getTicketStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

/* GET /api/roadmap — composite tree: versions → features (with tickets) */
export async function GET() {
  try {
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

    const versions = allVersions.map((v) => {
      const features = allFeatures
        .filter((f) => f.versionId === v.id)
        .map((f) => {
          const counts = ticketCounts.get(f.id) ?? { total: 0, done: 0 };
          const tickets = (ticketsByFeature.get(f.id) ?? []).map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            domain: t.domain,
            priority: t.priority,
            startDate: t.startDate,
            endDate: t.endDate,
          }));
          return {
            ...f,
            ticketCount: counts.total,
            doneTicketCount: counts.done,
            tickets,
          };
        });

      return { ...v, features };
    });

    return NextResponse.json({ versions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load roadmap." },
      { status: 500 },
    );
  }
}
