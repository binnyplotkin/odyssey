import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getDb, worldsTable } from "@odyssey/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const counts = await db
    .select({ status: worldsTable.status, n: sql<number>`count(*)::int` })
    .from(worldsTable)
    .groupBy(worldsTable.status);

  console.log("Worlds by status:");
  for (const r of counts) console.log(`  ${r.status}: ${r.n}`);

  const nonArchived = await db
    .select({ id: worldsTable.id, title: worldsTable.title, status: worldsTable.status })
    .from(worldsTable)
    .where(sql`${worldsTable.status} <> 'archived'`);

  console.log(`\nNon-archived rows (${nonArchived.length}):`);
  for (const r of nonArchived) console.log(`  [${r.status}] ${r.id}  ${r.title}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
