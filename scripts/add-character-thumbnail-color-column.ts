/**
 * One-off migration: add characters.thumbnail_color (text, nullable) and
 * backfill it from the legacy slug-hash gradient so existing characters
 * keep their look.
 *
 * Pairs with apps/admin/src/lib/avatar-gradients.ts — the hash function
 * and ordering here MUST match `legacyGradientKeyForSlug` so the UI
 * doesn't flip colors at first read after migration.
 *
 * Usage:
 *   npx tsx scripts/add-character-thumbnail-color-column.ts
 *
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS, and the backfill only
 * touches rows where thumbnail_color IS NULL.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const ORIGINAL_SIX = ["dune", "mint", "fog", "amethyst", "amber", "moss"] as const;

function legacyKey(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  return ORIGINAL_SIX[Math.abs(h) % ORIGINAL_SIX.length];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  process.stdout.write("  ALTER TABLE characters ADD COLUMN IF NOT EXISTS thumbnail_color text … ");
  await sql.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS thumbnail_color text`);
  console.log("ok");

  const rows = (await sql.query(
    `SELECT id, slug FROM characters WHERE thumbnail_color IS NULL`,
  )) as Array<{ id: string; slug: string }>;

  if (rows.length === 0) {
    console.log("\nNo characters need backfilling.");
    return;
  }

  console.log(`\nBackfilling ${rows.length} character(s) from slug-hash:`);
  for (const row of rows) {
    const key = legacyKey(row.slug);
    await sql.query(
      `UPDATE characters SET thumbnail_color = $1 WHERE id = $2`,
      [key, row.id],
    );
    console.log(`  ${row.slug.padEnd(40)} → ${key}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
