/**
 * Destructive: drop the `world_characters` bridge table.
 *
 * Safe to run because:
 *   - No TS code references worldCharactersTable anymore (Phase 4 stripped
 *     linkToWorld/unlinkFromWorld/listForWorld; countWorldsFor now queries
 *     world_nodes).
 *   - Ground truth for character↔world is now world_nodes (kind='character').
 *
 * Usage:
 *   npx tsx scripts/drop-world-characters-table.ts           # dry-run: show row count
 *   npx tsx scripts/drop-world-characters-table.ts --apply   # DROP TABLE world_characters CASCADE
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getDb } from "@odyssey/db";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }

  const existsRows = await db.execute(
    sql`SELECT to_regclass('public.world_characters') AS oid`,
  );
  const rowList = (existsRows as unknown as { rows?: Array<{ oid: string | null }> }).rows
    ?? (existsRows as unknown as Array<{ oid: string | null }>);
  const exists = !!rowList?.[0]?.oid;

  if (!exists) {
    console.log("Table world_characters does not exist — nothing to do.");
    return;
  }

  const countRows = await db.execute(
    sql`SELECT count(*)::int AS n FROM world_characters`,
  );
  const countList = (countRows as unknown as { rows?: Array<{ n: number }> }).rows
    ?? (countRows as unknown as Array<{ n: number }>);
  const n = countList?.[0]?.n ?? 0;

  console.log(`Mode: ${APPLY ? "APPLY" : "dry-run"}`);
  console.log(`world_characters row count: ${n}`);

  if (!APPLY) {
    console.log("\nWould run: DROP TABLE world_characters CASCADE;");
    console.log("Re-run with --apply to execute.");
    return;
  }

  await db.execute(sql`DROP TABLE world_characters CASCADE`);
  console.log("✓ Dropped world_characters.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
