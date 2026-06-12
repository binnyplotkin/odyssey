/**
 * Drop the legacy worlds / simulation tables now that the scenes stack
 * has fully replaced them.
 *
 * Destructive and irreversible. Run only after confirming the new scenes
 * stack works and no code references these tables.
 *
 * Usage:
 *   npx tsx scripts/drop-legacy-world-tables.ts
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DROPS = [
  // World session children + parent (FKs handled by CASCADE).
  "DROP TABLE IF EXISTS world_session_audio_artifacts CASCADE",
  "DROP TABLE IF EXISTS world_session_events CASCADE",
  "DROP TABLE IF EXISTS world_session_turns CASCADE",
  "DROP TABLE IF EXISTS world_session_context_builds CASCADE",
  "DROP TABLE IF EXISTS world_sessions CASCADE",
  // World graph + worlds.
  "DROP TABLE IF EXISTS world_edges CASCADE",
  "DROP TABLE IF EXISTS world_nodes CASCADE",
  "DROP TABLE IF EXISTS world_characters CASCADE",
  "DROP TABLE IF EXISTS worlds CASCADE",
  // Oldest game-simulation tables.
  "DROP TABLE IF EXISTS turns CASCADE",
  "DROP TABLE IF EXISTS sessions CASCADE",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(url);

  for (const stmt of DROPS) {
    process.stdout.write(`  ${stmt} … `);
    try {
      await sql.query(stmt);
      console.log("ok");
    } catch (err: any) {
      console.log("FAIL");
      console.error(err.message ?? err);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${DROPS.length} tables dropped (if present).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
