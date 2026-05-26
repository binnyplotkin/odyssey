/**
 * One-off migration: expand the voices object model with curation
 * metadata, soft-delete, audit, a previews gallery child table, and an
 * extraction-attempts journal. Pairs with the /voices admin surface and
 * the updated voice-store.
 *
 * Adds to `voices`:
 *   tags text[] NOT NULL DEFAULT '{}'
 *   language    text NULL          (BCP-47, e.g. "en-US")
 *   gender      text NULL          (masc | fem | neutral | other)
 *   license     text NULL          ("internal" | "CC-BY 4.0" | …)
 *   attribution text NULL
 *   archived_at timestamptz NULL   (soft-delete)
 *   updated_by  text NULL          (FK users.id ON DELETE SET NULL)
 *
 * Adds tables:
 *   voice_previews              (one-to-many gallery; canonical preview
 *                                stays on voices.preview_path)
 *   voice_extraction_attempts   (per-voice monotonic journal; current
 *                                state remains mirrored on voices.status)
 *
 * Indexes:
 *   voices_archived_at_idx
 *   voice_previews_voice_id_idx
 *   voice_extraction_attempts_unique_idx        (voice_id, attempt_number)
 *   voice_extraction_attempts_voice_id_idx
 *
 * Usage:
 *   npx tsx scripts/expand-voices-schema.ts
 *
 * Required env: DATABASE_URL
 *
 * Safe to re-run — every statement uses IF NOT EXISTS / DO $$ guards.
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

  // ── voices: new columns ─────────────────────────────────────────────
  process.stdout.write("  ALTER voices ADD tags … ");
  await sql.query(
    `ALTER TABLE voices ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[]`,
  );
  console.log("ok");

  process.stdout.write("  ALTER voices ADD language … ");
  await sql.query(`ALTER TABLE voices ADD COLUMN IF NOT EXISTS language text`);
  console.log("ok");

  process.stdout.write("  ALTER voices ADD gender … ");
  await sql.query(`ALTER TABLE voices ADD COLUMN IF NOT EXISTS gender text`);
  console.log("ok");

  process.stdout.write("  ALTER voices ADD license … ");
  await sql.query(`ALTER TABLE voices ADD COLUMN IF NOT EXISTS license text`);
  console.log("ok");

  process.stdout.write("  ALTER voices ADD attribution … ");
  await sql.query(`ALTER TABLE voices ADD COLUMN IF NOT EXISTS attribution text`);
  console.log("ok");

  process.stdout.write("  ALTER voices ADD archived_at … ");
  await sql.query(
    `ALTER TABLE voices ADD COLUMN IF NOT EXISTS archived_at timestamptz`,
  );
  console.log("ok");

  process.stdout.write("  ALTER voices ADD updated_by … ");
  await sql.query(`ALTER TABLE voices ADD COLUMN IF NOT EXISTS updated_by text`);
  console.log("ok");

  process.stdout.write("  ADD FK voices.updated_by → users(id) … ");
  await sql.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'voices_updated_by_fkey'
      ) THEN
        ALTER TABLE voices
          ADD CONSTRAINT voices_updated_by_fkey
          FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  console.log("ok");

  process.stdout.write("  CREATE INDEX voices_archived_at_idx … ");
  await sql.query(
    `CREATE INDEX IF NOT EXISTS voices_archived_at_idx ON voices (archived_at)`,
  );
  console.log("ok");

  // ── voice_previews ──────────────────────────────────────────────────
  process.stdout.write("  CREATE TABLE voice_previews … ");
  await sql.query(`
    CREATE TABLE IF NOT EXISTS voice_previews (
      id text PRIMARY KEY,
      voice_id text NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
      label text NOT NULL,
      path text NOT NULL,
      duration_s real,
      sample_rate integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log("ok");

  process.stdout.write("  CREATE INDEX voice_previews_voice_id_idx … ");
  await sql.query(
    `CREATE INDEX IF NOT EXISTS voice_previews_voice_id_idx ON voice_previews (voice_id)`,
  );
  console.log("ok");

  // ── voice_extraction_attempts ───────────────────────────────────────
  process.stdout.write("  CREATE TABLE voice_extraction_attempts … ");
  await sql.query(`
    CREATE TABLE IF NOT EXISTS voice_extraction_attempts (
      id text PRIMARY KEY,
      voice_id text NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
      attempt_number integer NOT NULL,
      status text NOT NULL,
      error text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )
  `);
  console.log("ok");

  process.stdout.write("  CREATE UNIQUE INDEX voice_extraction_attempts_unique_idx … ");
  await sql.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS voice_extraction_attempts_unique_idx
       ON voice_extraction_attempts (voice_id, attempt_number)`,
  );
  console.log("ok");

  process.stdout.write("  CREATE INDEX voice_extraction_attempts_voice_id_idx … ");
  await sql.query(
    `CREATE INDEX IF NOT EXISTS voice_extraction_attempts_voice_id_idx
       ON voice_extraction_attempts (voice_id)`,
  );
  console.log("ok");

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
