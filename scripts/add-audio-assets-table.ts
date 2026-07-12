/**
 * One-off migration: create the `audio_assets` global sound-library table
 * on Neon (DATABASE_URL), create the two private Supabase Storage buckets
 * (`sound-sources`, `sound-processed`), seed the `tent-evening` ambience
 * from apps/admin/public/ambience, and convert legacy `ambience` scene
 * nodes into library-backed `audio` nodes. Pairs with the admin /sounds
 * surface.
 *
 * Seeded / converted assets land as status='uploaded' (source bytes only;
 * no canonical 48k mono WAV yet) — run "Process" on the /sounds page to
 * ingest them client-side, which flips them to 'ready'.
 *
 * Usage:
 *   npx tsx scripts/add-audio-assets-table.ts
 *
 * Required env: DATABASE_URL. Optional: SUPABASE_URL +
 * SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY (bucket + seed-upload
 * steps are skipped without them).
 *
 * Safe to re-run — every statement uses IF NOT EXISTS / ON CONFLICT, the
 * bucket creator treats "already exists" as success, and node conversion
 * only touches rows still at kind='ambience'.
 */

import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SOURCES_BUCKET = "sound-sources";
const PROCESSED_BUCKET = "sound-processed";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  process.stdout.write("  CREATE TABLE audio_assets … ");
  await sql.query(`
    CREATE TABLE IF NOT EXISTS audio_assets (
      id text PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      tags text[] NOT NULL DEFAULT '{}',
      loopable boolean NOT NULL DEFAULT false,
      source text NOT NULL DEFAULT 'upload',
      generation_prompt text,
      status text NOT NULL DEFAULT 'uploaded',
      status_error text,
      source_path text,
      processed_path text,
      duration_s real,
      sample_rate integer,
      rms_db real,
      peak_db real,
      license text,
      attribution text,
      archived_at timestamptz,
      created_by text REFERENCES users(id) ON DELETE SET NULL,
      updated_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log("ok");

  process.stdout.write("  CREATE INDEX audio_assets_status_idx … ");
  await sql.query(
    `CREATE INDEX IF NOT EXISTS audio_assets_status_idx ON audio_assets (status)`,
  );
  console.log("ok");

  process.stdout.write("  CREATE INDEX audio_assets_archived_at_idx … ");
  await sql.query(
    `CREATE INDEX IF NOT EXISTS audio_assets_archived_at_idx ON audio_assets (archived_at)`,
  );
  console.log("ok");

  const supabase = makeSupabase();
  if (supabase) await ensureBuckets(supabase);

  await seedTentEvening(sql, supabase);
  await convertAmbienceNodes(sql);

  console.log("\nDone.");
}

function makeSupabase(): SupabaseClient | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.log(
      "  Supabase … skipped (SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY not set)",
    );
    return null;
  }
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureBuckets(supabase: SupabaseClient) {
  for (const id of [SOURCES_BUCKET, PROCESSED_BUCKET] as const) {
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

/**
 * Seed the one pre-library ambience track. Slug doubles as the runtime
 * track id, so `tent-evening` keeps meaning for existing SceneState values
 * and the /ambience/tent-evening.mp3 fallback path.
 */
async function seedTentEvening(
  sql: ReturnType<typeof neon>,
  supabase: SupabaseClient | null,
) {
  process.stdout.write("  Seed audio_assets tent-evening … ");
  const id = crypto.randomUUID();
  const rows = await sql.query(
    `
    INSERT INTO audio_assets
      (id, slug, name, description, tags, loopable, source, status, source_path)
    VALUES
      ($1, 'tent-evening', 'Tent — Evening',
       'Night desert camp: low fire crackle, distant wind, sparse and calm.',
       ARRAY['ambience','desert','night'], true, 'upload', 'uploaded',
       $2)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id
    `,
    [id, `${id}.wav`],
  );
  if (rows.length === 0) {
    console.log("exists");
    return;
  }
  console.log("created");

  if (!supabase) {
    console.log("  Upload tent-evening.wav … skipped (no Supabase creds)");
    return;
  }
  process.stdout.write("  Upload tent-evening.wav → sound-sources … ");
  try {
    const wavPath = path.join(
      process.cwd(),
      "apps/admin/public/ambience/tent-evening.wav",
    );
    const bytes = await readFile(wavPath);
    const { error } = await supabase.storage
      .from(SOURCES_BUCKET)
      .upload(`${id}.wav`, bytes, { contentType: "audio/wav", upsert: true });
    if (error) throw new Error(error.message);
    console.log("ok");
  } catch (err) {
    // Leave the row in place (status='uploaded', sourcePath set) — a
    // re-run or a manual upload via /sounds can complete it.
    console.log(`failed (${err instanceof Error ? err.message : String(err)})`);
  }
}

/**
 * Convert legacy free-text `ambience` nodes to library-backed `audio`
 * nodes. Any trackId without a matching asset gets a placeholder asset
 * row (status='uploaded', no bytes) so the refId is always valid.
 */
async function convertAmbienceNodes(sql: ReturnType<typeof neon>) {
  const nodes = await sql.query(
    `SELECT id, scene_id, label, data FROM scene_nodes WHERE kind = 'ambience'`,
  );
  if (nodes.length === 0) {
    console.log("  Convert ambience nodes … none found");
    return;
  }
  for (const node of nodes as Array<{
    id: string;
    scene_id: string;
    label: string;
    data: { trackId?: string; description?: string; isDefault?: boolean };
  }>) {
    const trackId = node.data?.trackId?.trim();
    process.stdout.write(`  Convert node ${node.id} (trackId=${trackId ?? "?"}) … `);
    if (!trackId) {
      console.log("skipped (no trackId)");
      continue;
    }

    // Find-or-create the asset for this slug.
    let assetRows = await sql.query(
      `SELECT id FROM audio_assets WHERE slug = $1`,
      [trackId],
    );
    if (assetRows.length === 0) {
      const assetId = crypto.randomUUID();
      assetRows = await sql.query(
        `
        INSERT INTO audio_assets (id, slug, name, description, loopable, source, status)
        VALUES ($1, $2, $3, $4, true, 'upload', 'uploaded')
        ON CONFLICT (slug) DO UPDATE SET updated_at = now()
        RETURNING id
        `,
        [assetId, trackId, node.label || trackId, node.data?.description ?? null],
      );
    }
    const refId = (assetRows[0] as { id: string }).id;

    await sql.query(
      `
      UPDATE scene_nodes
      SET kind = 'audio',
          ref_id = $2,
          data = jsonb_build_object('role', 'bed')
                 || CASE WHEN (data->>'isDefault')::boolean IS TRUE
                         THEN '{"isDefault": true}'::jsonb
                         ELSE '{}'::jsonb END,
          updated_at = now()
      WHERE id = $1 AND kind = 'ambience'
      `,
      [node.id, refId],
    );
    console.log(`→ audio (ref ${refId.slice(0, 8)}…)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
