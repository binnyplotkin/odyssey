/**
 * Archive all worlds in the DB except a configured keep-list.
 *
 * Usage:
 *   npx tsx scripts/archive-worlds.ts             # dry-run (preview only)
 *   npx tsx scripts/archive-worlds.ts --apply     # actually update
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getDb, worldsTable } from "@odyssey/db";
import { eq, not, inArray, and } from "drizzle-orm";

const KEEP_IDS = ["abrahams-tent-base"];
const APPLY = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL not set — nothing to do.");
    process.exit(1);
  }

  const rows = await db
    .select({ id: worldsTable.id, title: worldsTable.title, status: worldsTable.status })
    .from(worldsTable);

  const toArchive = rows.filter((r) => !KEEP_IDS.includes(r.id) && r.status !== "archived");
  const keeping = rows.filter((r) => KEEP_IDS.includes(r.id));
  const alreadyArchived = rows.filter((r) => r.status === "archived");

  console.log(`Total worlds in DB: ${rows.length}`);
  console.log(`  Keeping active:   ${keeping.length}  ${keeping.map((w) => w.id).join(", ") || "—"}`);
  console.log(`  Already archived: ${alreadyArchived.length}`);
  console.log(`  Will archive:     ${toArchive.length}`);
  if (toArchive.length) {
    console.log("");
    for (const w of toArchive) {
      console.log(`    · ${w.id}  (${w.status})  ${w.title}`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to perform the update.");
    return;
  }
  if (!toArchive.length) {
    console.log("\nNothing to archive.");
    return;
  }

  const ids = toArchive.map((w) => w.id);
  const result = await db
    .update(worldsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(not(eq(worldsTable.status, "archived")), inArray(worldsTable.id, ids)));

  console.log(`\nArchived ${ids.length} world(s).`);
  void result;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
