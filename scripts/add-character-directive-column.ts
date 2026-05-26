/**
 * One-off migration: add characters.directive (jsonb, nullable).
 *
 * The L02 Directive holds the structured scope / exemplars / never /
 * framing / guidance fields that compile into the cached system envelope
 * as Frontier Playbook XML. Nullable so every character that existed
 * before this column was added (Abraham, the Tent cast, etc.) continues
 * to work with the legacy single-paragraph system prompt template until
 * an author opens the L02 editor and saves.
 *
 * Usage:
 *   npx tsx scripts/add-character-directive-column.ts
 *
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  process.stdout.write("  ALTER TABLE characters ADD COLUMN IF NOT EXISTS directive jsonb … ");
  try {
    await sql.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS directive jsonb`);
    console.log("ok");
  } catch (err) {
    console.log("FAIL");
    console.error((err as Error).message ?? err);
    process.exit(1);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
