/**
 * Delete a user by id, showing cascade impact first.
 *
 * Usage:
 *   npx tsx scripts/delete-user.ts <id>            # dry-run (shows counts)
 *   npx tsx scripts/delete-user.ts <id> --confirm  # actually delete
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import {
  usersTable,
  accountsTable,
  authSessionsTable,
  sceneSessionsTable,
} from "@odyssey/db";

async function main() {
  const id = process.argv[2];
  const confirm = process.argv.includes("--confirm");
  if (!id) {
    console.error("Usage: npx tsx scripts/delete-user.ts <id> [--confirm]");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const db = drizzle({ client: neon(url) });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    console.error(`No user with id ${id}`);
    process.exit(1);
  }

  const [accounts, authSessions, sceneSessions] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(accountsTable).where(eq(accountsTable.userId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(authSessionsTable).where(eq(authSessionsTable.userId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(sceneSessionsTable).where(eq(sceneSessionsTable.userId, id)),
  ]);

  console.log(`User: ${user.name ?? "(no name)"} <${user.email}> [${user.role}] id=${user.id}`);
  console.log(`Cascade impact:`);
  console.log(`  accounts:       ${accounts[0].n}`);
  console.log(`  auth_sessions:  ${authSessions[0].n}`);
  console.log(`  scene_sessions: ${sceneSessions[0].n}`);

  if (!confirm) {
    console.log(`\nDry-run. Re-run with --confirm to actually delete.`);
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  console.log(`\nDeleted user ${id} (cascaded rows removed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
