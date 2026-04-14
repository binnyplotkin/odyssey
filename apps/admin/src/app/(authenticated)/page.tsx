import {
  getWorldRepository,
  getPersistenceStore,
  getTicketStore,
  getPlatformVersionStore,
  getChangelogStore,
} from "@odyssey/db";
import { StatCard } from "@/components/stat-card";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [worlds, sessions, tickets, platformVersions, changelog] = await Promise.all([
    getWorldRepository().listWorlds(),
    getPersistenceStore().listSessions(),
    getTicketStore().list(),
    getPlatformVersionStore().list(),
    getChangelogStore().list(),
  ]);

  const activeSessions = sessions.filter((s) => s.status === "active");
  const openTickets = tickets.filter((t) => t.status !== "done");
  const activeVersion = platformVersions.find((v) => v.status === "released" || v.status === "active")
    ?? platformVersions[0] ?? null;

  return (
    <DashboardClient
      stats={{
        worlds: worlds.length,
        sessions: sessions.length,
        activeSessions: activeSessions.length,
        tickets: tickets.length,
        openTickets: openTickets.length,
        versions: platformVersions.length,
      }}
      activeVersion={activeVersion}
      recentChangelog={changelog.slice(0, 10)}
      recentSessions={sessions.slice(0, 5)}
      changelogTotal={changelog.length}
    />
  );
}
