/**
 * One-off migration: create the `voices` global library table on Neon
 * (DATABASE_URL), add `characters.voice_id`, and create the two private
 * Supabase Storage buckets (`voice-sources`, `voice-embeddings`) via the
 * Supabase admin API. Pairs with the new admin /voices surface.
 *
 * Neon and Supabase Storage are separate Postgres instances in this
 * project, so the bucket step goes through @supabase/supabase-js rather
 * than SQL.
 *
 * Usage:
 *   npx tsx scripts/add-voices-table.ts
 *
 * Required env: DATABASE_URL, SUPABASE_URL, and either SUPABASE_SECRET_KEY
 * or SUPABASE_SERVICE_ROLE_KEY (the script accepts either name).
 *
 * Safe to re-run — every statement uses IF NOT EXISTS, the FK guard is
 * idempotent, and the bucket creator treats "already exists" as success.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  process.stdout.write("  CREATE TABLE voices … ");
  await sql.query(`
    CREATE TABLE IF NOT EXISTS voices (
      id text PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'uploaded',
      status_error text,
      source_path text,
      embedding_path text,
      preview_path text,
      duration_s real,
      sample_rate integer,
      created_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log("ok");

  process.stdout.write("  CREATE INDEX voices_status_idx … ");
  await sql.query(`CREATE INDEX IF NOT EXISTS voices_status_idx ON voices (status)`);
  console.log("ok");

  process.stdout.write("  ALTER TABLE characters ADD COLUMN voice_id … ");
  await sql.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS voice_id text`);
  console.log("ok");

  // Done as a separate ALTER so existing characters rows aren't blocked
  // if voices is mid-creation. ON DELETE SET NULL matches the Drizzle decl.
  process.stdout.write("  ADD FK characters.voice_id → voices(id) … ");
  await sql.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'characters_voice_id_fkey'
      ) THEN
        ALTER TABLE characters
          ADD CONSTRAINT characters_voice_id_fkey
          FOREIGN KEY (voice_id) REFERENCES voices(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  console.log("ok");

  await ensureBuckets();

  console.log("\nDone.");
}

async function ensureBuckets() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.log(
      "  Storage buckets … skipped (SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY not set)",
    );
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const id of ["voice-sources", "voice-embeddings"] as const) {
    process.stdout.write(`  Storage bucket ${id} … `);
    const { error } = await supabase.storage.createBucket(id, { public: false });
    // The admin API returns a 409-style error when the bucket already exists;
    // surface its message but treat as success so the script stays idempotent.
    if (error && !/already exists/i.test(error.message)) {
      console.log(`failed (${error.message})`);
      continue;
    }
    console.log(error ? "exists" : "created");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
