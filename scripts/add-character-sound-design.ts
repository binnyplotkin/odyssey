/**
 * One-off migration: add `characters.sound_design` (jsonb) — the sm-sound
 * harness layer's character-level soundscape binding (ambience bed by
 * audio_assets slug + gain trim). Pairs with the harness Sound design
 * editor; consumed by SceneDriver.fromCharacter and the character sandbox.
 *
 * Usage:
 *   npx tsx scripts/add-character-sound-design.ts
 *
 * Required env: DATABASE_URL. Safe to re-run (IF NOT EXISTS).
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

  process.stdout.write("  ALTER TABLE characters ADD COLUMN sound_design … ");
  await sql.query(
    `ALTER TABLE characters ADD COLUMN IF NOT EXISTS sound_design jsonb`,
  );
  console.log("ok");

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
