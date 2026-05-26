/**
 * One-off migration: add characters.voice_style (jsonb, nullable).
 *
 * The L03 Voice & Style holds the four orthogonal personality axes
 * (tone palette, decision spectrum, brevity, register pad) plus the
 * audio voice prompt + prosody hints. Compiled into the `<voice>` block
 * of the cached system envelope; in 1.3b the audio fields also feed
 * the TTS pipeline.
 *
 * Nullable so every character that existed before this column was added
 * continues to work — buildSystemPromptParts skips the `<voice>` block
 * when null and the runtime uses its existing legacy voice path.
 *
 * Usage:
 *   npx tsx scripts/add-character-voice-style-column.ts
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

  process.stdout.write("  ALTER TABLE characters ADD COLUMN IF NOT EXISTS voice_style jsonb … ");
  try {
    await sql.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS voice_style jsonb`);
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
