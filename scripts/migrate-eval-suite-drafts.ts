/**
 * V5: lift eval_suites from immutable-only → mutable-draft + immutable-published.
 *
 * Adds:
 *   - published_at timestamptz (null = draft, set = immutable)
 *   - release_notes text (replaces / augments the legacy `notes` column)
 *   - forked_from_id text (provenance: which version this draft branched from)
 *   - eval_suites_published_idx index on (character_id, published_at)
 *   - eval_suites_draft_unique partial index — at most ONE draft per
 *     (character_id, slug) so the UI doesn't have to disambiguate
 *
 * Backfills published_at = created_at on existing rows: every row that
 * existed before this migration was created by the seed script, which only
 * inserts published versions. Treating them as published preserves their
 * immutability contract.
 *
 * Usage: npx tsx scripts/migrate-eval-suite-drafts.ts
 *
 * Idempotent (every statement IF NOT EXISTS / DROP CONSTRAINT IF EXISTS).
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [
  `ALTER TABLE eval_suites ADD COLUMN IF NOT EXISTS published_at  timestamptz`,
  `ALTER TABLE eval_suites ADD COLUMN IF NOT EXISTS release_notes text`,
  `ALTER TABLE eval_suites ADD COLUMN IF NOT EXISTS forked_from_id text`,

  // Treat every pre-existing row as published (they were inserted by the
  // seed script, which only produced finalized versions). New drafts will
  // explicitly set published_at = NULL on insert.
  `UPDATE eval_suites SET published_at = created_at WHERE published_at IS NULL AND created_at IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS eval_suites_published_idx
     ON eval_suites (character_id, published_at)`,

  // The partial unique index is the integrity backbone of drafts: only one
  // editable draft per (character, slug) at a time. Multiple published
  // versions coexist (they all have non-null published_at).
  `CREATE UNIQUE INDEX IF NOT EXISTS eval_suites_draft_unique
     ON eval_suites (character_id, slug)
     WHERE published_at IS NULL`,
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(url);

  for (const stmt of DDL) {
    const head = stmt.slice(0, 78);
    process.stdout.write(`  ${head}${stmt.length > 78 ? "…" : ""} … `);
    try {
      const res = await sql.query(stmt);
      // UPDATEs return rowCount; CREATE/ALTER return null/undefined.
      const count = (res as { rowCount?: number })?.rowCount;
      console.log(typeof count === "number" ? `ok · ${count} rows` : "ok");
    } catch (err: unknown) {
      console.log("FAIL");
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${DDL.length} DDL statements executed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
