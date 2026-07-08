/**
 * Add the `brief` column to `characters`.
 *
 * The brief is the world owner's plain-language explanation of who the
 * character is — authored seed context for generating the ingestion prompt
 * (see packages/wiki-ingest/src/generate.ts). Nullable text; no backfill
 * needed (null = "no brief written yet", the pre-existing state).
 *
 * Usage:
 *   npx tsx scripts/migrate-character-brief.ts
 *
 * Idempotent — ADD COLUMN IF NOT EXISTS.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [`ALTER TABLE characters ADD COLUMN IF NOT EXISTS brief text`];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(url);

  for (const stmt of DDL) {
    process.stdout.write(`  ${stmt} … `);
    try {
      await sql.query(stmt);
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(err);
      process.exit(1);
    }
  }

  const [check] = (await sql.query(
    `SELECT is_nullable, data_type FROM information_schema.columns
     WHERE table_name = 'characters' AND column_name = 'brief'`,
  )) as Array<{ is_nullable: string; data_type: string }>;
  console.log(
    check
      ? `  verified: characters.brief exists (${check.data_type}, nullable=${check.is_nullable})`
      : "  WARNING: column not found after migration",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
