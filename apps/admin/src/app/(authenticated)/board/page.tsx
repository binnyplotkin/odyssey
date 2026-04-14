import { getTicketStore, getFeatureStore } from "@odyssey/db";
import type { Ticket } from "@/data/board";
import BoardClient from "./board-client";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const [records, featureRecords] = await Promise.all([
    getTicketStore().list(),
    getFeatureStore().list(),
  ]);

  const tickets: Ticket[] = records.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? undefined,
    status: r.status as Ticket["status"],
    domain: (r.domain ?? undefined) as Ticket["domain"],
    priority: (r.priority ?? undefined) as Ticket["priority"],
    assignee: r.assignee ?? undefined,
    phase: r.phase ?? undefined,
    featureId: r.featureId ?? undefined,
    startDate: r.startDate ?? undefined,
    endDate: r.endDate ?? undefined,
    createdAt: r.createdAt,
    subtasks: (r.subtasks ?? undefined) as Ticket["subtasks"],
    activity: (r.activity ?? undefined) as Ticket["activity"],
  }));

  const features = featureRecords.map((f) => ({ id: f.id, title: f.title }));

  return <BoardClient initialTickets={tickets} features={features} />;
}
