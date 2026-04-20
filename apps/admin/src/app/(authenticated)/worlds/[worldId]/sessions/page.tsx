import { notFound } from "next/navigation";
import { getPersistenceStore } from "@odyssey/db";
import { getAdminWorldRepository } from "@/lib/worlds";
import { WorldSessionsPanel } from "@/components/world-sessions-panel";

export const dynamic = "force-dynamic";

export default async function WorldSessionsPage({
  params,
}: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await params;
  const detail = await getAdminWorldRepository().getWorldDetail(worldId);
  if (!detail) notFound();

  let sessions: Awaited<ReturnType<ReturnType<typeof getPersistenceStore>["listSessions"]>> = [];
  try {
    const all = await getPersistenceStore().listSessions();
    sessions = all.filter((s) => s.worldId === detail.world.id);
  } catch {
    // Store unavailable — render empty panel.
  }

  return <WorldSessionsPanel world={detail.world} sessions={sessions} />;
}
