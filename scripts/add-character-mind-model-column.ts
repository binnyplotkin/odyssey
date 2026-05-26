/**
 * One-off migration: add characters.mind_model (jsonb, nullable).
 *
 * The L04 Brain / Model holds the per-character LLM substrate config:
 * provider, model id, sampling knobs (temperature, top_p, max_tokens),
 * cache preference, and optional fallback chain. Read by the chat route
 * to override its hardcoded defaults on a per-character basis.
 *
 * Nullable so every character that existed before this column was added
 * continues to work — the chat route uses defaults (claude-sonnet-4-5,
 * max_tokens 1024, Anthropic defaults for temp + top_p) when null.
 *
 * Usage:
 *   npx tsx scripts/add-character-mind-model-column.ts
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

  process.stdout.write("  ALTER TABLE characters ADD COLUMN IF NOT EXISTS mind_model jsonb … ");
  try {
    await sql.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS mind_model jsonb`);
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
