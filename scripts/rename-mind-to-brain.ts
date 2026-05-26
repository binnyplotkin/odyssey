/**
 * One-shot schema migration: rename `characters.mind_model` to
 * `characters.brain_model` to match the UI naming refactor (the L04 tab
 * is now "Brain" instead of "Mind"). The column is jsonb and contains
 * the `CharacterBrainModel` shape (model, temperature, top_p, max_tokens,
 * voice override, etc.) — payload shape is unchanged, only the column
 * name flips.
 *
 * Idempotent: detects whether the rename has already been applied via
 * `information_schema.columns` and exits cleanly when there's nothing
 * to do.
 *
 * Usage:
 *   npx tsx scripts/rename-mind-to-brain.ts          # dry run (no writes)
 *   npx tsx scripts/rename-mind-to-brain.ts --apply  # perform the rename
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { sql } from "drizzle-orm";
import { getDb } from "@odyssey/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  console.log(APPLY ? "Running migration…" : "Dry run (no writes — pass --apply to commit).");

  const cols = await db.execute<{ column_name: string }>(sql`
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'characters'
       and column_name in ('mind_model', 'brain_model')
  `);
  const names = new Set(cols.rows.map((r) => r.column_name));

  if (names.has("brain_model") && !names.has("mind_model")) {
    console.log("✓ Already migrated — characters.brain_model exists.");
    return;
  }
  if (!names.has("mind_model")) {
    console.log("× Source column characters.mind_model not found. Nothing to do.");
    return;
  }
  if (names.has("brain_model") && names.has("mind_model")) {
    console.log("⚠  Both characters.mind_model and characters.brain_model exist — manual inspection needed.");
    return;
  }

  console.log("→ Will: ALTER TABLE characters RENAME COLUMN mind_model TO brain_model;");
  if (!APPLY) return;

  await db.execute(sql`alter table characters rename column mind_model to brain_model`);
  console.log("✓ Renamed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
