/**
 * Backfill the typed `classify` block onto existing `wiki_sources` rows.
 *
 * Part of the kind→sourceType collapse. New rows already get `metadata.classify`
 * via `createSource` → `buildStoredSourceMetadata`; this applies the same shape to
 * pre-existing rows so nothing depends on live coercion and the repointed filter
 * query hits `classify.facets` directly.
 *
 * Non-destructive: only adds `metadata.classify`, preserving all other keys.
 * Idempotent: rows that already carry a valid `classify` block are skipped.
 * Timestamps are left untouched (backfill is a system op, not a user edit).
 *
 * Usage:
 *   npx tsx scripts/backfill-source-classify.ts            # dry run (default)
 *   npx tsx scripts/backfill-source-classify.ts --apply    # write
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { buildStoredSourceMetadata } from "@odyssey/db";
import type { WikiSourceKind } from "@odyssey/db";

const APPLY = process.argv.includes("--apply");

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasClassify(meta: Record<string, unknown>): boolean {
  const c = meta.classify;
  return (
    isRecord(c) &&
    isRecord(c.provenance) &&
    typeof (c.provenance as { ingestionType?: unknown }).ingestionType === "string"
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  const rows = (await sql.query(
    "SELECT id, kind, metadata FROM wiki_sources ORDER BY created_at",
  )) as Array<{ id: string; kind: string | null; metadata: unknown }>;

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const meta = isRecord(row.metadata) ? row.metadata : {};
    if (hasClassify(meta)) {
      skipped++;
      continue;
    }
    const next = buildStoredSourceMetadata(
      (row.kind ?? "reference") as WikiSourceKind,
      meta,
    );
    if (APPLY) {
      await sql.query(
        "UPDATE wiki_sources SET metadata = $1::jsonb WHERE id = $2",
        [JSON.stringify(next), row.id],
      );
    }
    updated++;
  }

  console.log(
    `${APPLY ? "Applied" : "Dry run"} · ${rows.length} rows · ` +
      `${updated} ${APPLY ? "updated" : "would update"} · ` +
      `${skipped} already had classify`,
  );
  if (!APPLY && updated > 0) {
    console.log("Re-run with --apply to write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
