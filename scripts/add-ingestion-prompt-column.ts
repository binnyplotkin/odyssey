/**
 * One-off migration: add characters.ingestion_prompt (text, nullable).
 *
 * This is the single domain-awareness knob — injected into every ingestion
 * run's system prompt so the generic engine interprets raw sources through
 * this character's tradition (scripture vs canon novel vs worldbook).
 *
 * Usage:
 *   npx tsx scripts/add-ingestion-prompt-column.ts
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

  process.stdout.write("  ALTER TABLE characters ADD COLUMN IF NOT EXISTS ingestion_prompt text … ");
  try {
    await sql.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS ingestion_prompt text`);
    console.log("ok");
  } catch (err: any) {
    console.log("FAIL");
    console.error(err.message ?? err);
    process.exit(1);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
