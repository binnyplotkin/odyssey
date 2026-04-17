/**
 * One-off migration: add wiki_ingestion_log.{model,prompt_hash}.
 *
 *   model       — the LLM model used for the run (e.g. "claude-sonnet-4-5")
 *   prompt_hash — short SHA of the character.ingestionPrompt at run time,
 *                 for reproducibility + "did the prompt drift?" analysis.
 *
 * Usage:
 *   npx tsx scripts/add-ingestion-run-metadata.ts
 *
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [
  `ALTER TABLE wiki_ingestion_log ADD COLUMN IF NOT EXISTS model        text`,
  `ALTER TABLE wiki_ingestion_log ADD COLUMN IF NOT EXISTS prompt_hash  text`,
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  for (const stmt of DDL) {
    process.stdout.write(`  ${stmt.slice(0, 70)}… `);
    try {
      await sql.query(stmt);
      console.log("ok");
    } catch (err: any) {
      console.log("FAIL");
      console.error(err.message ?? err);
      process.exit(1);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
