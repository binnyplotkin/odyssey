import { getWorldSessionStore } from "@odyssey/db";
import { SessionsTable, type SessionRow } from "@/components/sessions-table";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const worldSessions = await getWorldSessionStore().listSessionSummaries(50);
  const sessions: SessionRow[] = worldSessions.map((session) => ({
    id: session.id,
    userId: session.userId,
    worldId: session.worldId,
    characterId: session.characterId,
    mode: session.mode,
    status: session.status,
    contextBuildCount: session.contextBuildCount,
    turnCount: session.turnCount,
    eventCount: session.eventCount,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastActiveAt: session.lastActiveAt,
  }));

  return <SessionsTable sessions={sessions} />;
}
