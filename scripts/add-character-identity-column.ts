/**
 * One-off migration: add characters.identity (jsonb, nullable).
 *
 * The L01 Identity holds the character's essence sentence, exactly-two
 * defining traits, and optional era/setting. Compiled into the
 * `<identity>` block at the top of the cached system envelope.
 *
 * Nullable so every character that existed before this column was added
 * continues to work — buildSystemPromptParts falls back to the hardcoded
 * "You are {title}…" anchor until the author opens the L01 editor and saves.
 *
 * Usage:
 *   npx tsx scripts/add-character-identity-column.ts
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

  process.stdout.write("  ALTER TABLE characters ADD COLUMN IF NOT EXISTS identity jsonb … ");
  try {
    await sql.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS identity jsonb`);
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
