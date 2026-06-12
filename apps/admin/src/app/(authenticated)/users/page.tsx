import { auth } from "@/lib/auth";
import { desc, sql } from "drizzle-orm";
import {
  getDb,
  usersTable,
  accountsTable,
  sceneSessionsTable,
} from "@odyssey/db";
import { UsersTable, type UserRow } from "@/components/users-table";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await auth();
  const currentUserId = session?.user?.id ?? null;

  const db = getDb();
  if (!db) {
    return (
      <div style={{ padding: "2rem", color: "var(--text-tertiary)" }}>
        Database unavailable.
      </div>
    );
  }

  // 1. All users, ordered by most recently created
  const userRows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      image: usersTable.image,
      passwordHash: usersTable.passwordHash,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));

  // 2. OAuth providers per user
  const accountRows = await db
    .select({
      userId: accountsTable.userId,
      provider: accountsTable.provider,
    })
    .from(accountsTable);

  const providersByUser = new Map<string, Set<string>>();
  for (const a of accountRows) {
    if (!providersByUser.has(a.userId)) providersByUser.set(a.userId, new Set());
    providersByUser.get(a.userId)!.add(a.provider);
  }

  // 3. Session count + last active per user (scene sessions)
  const sessionStats = await db
    .select({
      userId: sceneSessionsTable.userId,
      sessionCount: sql<number>`count(*)::int`.as("session_count"),
      lastActiveAt: sql<Date>`max(${sceneSessionsTable.lastActiveAt})`.as("last_active_at"),
    })
    .from(sceneSessionsTable)
    .groupBy(sceneSessionsTable.userId);

  const statsByUser = new Map<string, { count: number; lastActive: Date | null }>();
  for (const s of sessionStats) {
    if (!s.userId) continue;
    statsByUser.set(s.userId, {
      count: s.sessionCount ?? 0,
      lastActive: s.lastActiveAt ? new Date(s.lastActiveAt) : null,
    });
  }

  // 4. Compose UserRow[] for the client
  const users: UserRow[] = userRows.map((u) => {
    const providers = providersByUser.get(u.id) ?? new Set<string>();
    const authMethods: UserRow["authMethods"] = [];
    if (u.passwordHash) authMethods.push("password");
    if (providers.has("google")) authMethods.push("google");
    // Future providers (github, etc.) would append here.

    const stats = statsByUser.get(u.id);

    return {
      id: u.id,
      name: u.name ?? null,
      email: u.email,
      role: (u.role === "admin" ? "admin" : "user"),
      image: u.image ?? null,
      authMethods,
      sessionCount: stats?.count ?? 0,
      lastActiveAt: stats?.lastActive ? stats.lastActive.toISOString() : null,
      createdAt: u.createdAt.toISOString(),
    };
  });

  return <UsersTable users={users} currentUserId={currentUserId} />;
}
