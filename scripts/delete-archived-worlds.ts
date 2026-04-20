/**
 * Delete worlds with status='archived' from the DB. Cascades drop their
 * world_characters, world_nodes, and world_edges rows (via FK onDelete).
 * sessionsTable.worldId has no FK, so old sessions will become orphans —
 * that's the pre-existing behavior.
 *
 * Usage:
 *   npx tsx scripts/delete-archived-worlds.ts             # dry-run (preview only)
 *   npx tsx scripts/delete-archived-worlds.ts --apply     # actually delete
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getDb, worldsTable } from "@odyssey/db";
import { eq, inArray } from "drizzle-orm";

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

  const archived = rows.filter((r) => r.status === "archived");
  const active = rows.filter((r) => r.status !== "archived");

  console.log(`Mode: ${APPLY ? "APPLY" : "dry-run"}`);
  console.log(`Total worlds: ${rows.length}`);
  console.log(`  Active:    ${active.length}`);
  console.log(`  Archived:  ${archived.length}  (will be deleted)`);
  if (active.length) {
    console.log("\nKeeping active:");
    for (const w of active) console.log(`  · ${w.id}  ${w.title}`);
  }
  if (archived.length) {
    console.log("\nDeleting archived:");
    for (const w of archived) console.log(`  · ${w.id}  ${w.title}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to perform the delete.");
    return;
  }
  if (!archived.length) {
    console.log("\nNothing to delete.");
    return;
  }

  const ids = archived.map((w) => w.id);
  const result = await db
    .delete(worldsTable)
    .where(inArray(worldsTable.id, ids))
    .returning({ id: worldsTable.id });

  console.log(`\nDeleted ${result.length} world(s). Cascades dropped related world_nodes/world_edges/world_characters rows.`);
  void eq; // silence unused-import lint for future edits
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
