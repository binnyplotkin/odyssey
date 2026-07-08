/**
 * S4 (final): retire the `wiki_sources.kind` column (kind→sourceType collapse).
 *
 *   1. Preserve each row's `kind` into `metadata.classify.extra.legacyKind` — the
 *      tier (sourceType) is coarser, so commentary vs annotation would otherwise
 *      be lost. `normalizeSource`/`shadowKind` read this back for the derived
 *      `WikiSourceRecord.kind`.
 *   2. Safety gate: abort if any non-null kind wasn't preserved.
 *   3. DROP COLUMN kind.
 *
 * Idempotent. IRREVERSIBLE at step 3. Run only AFTER the code no longer selects
 * the column (schema.ts kind removed, normalizeSource + wikis-store repointed).
 *
 * Usage:
 *   npx tsx scripts/drop-source-kind-column.ts            # dry run (default)
 *   npx tsx scripts/drop-source-kind-column.ts --apply    # preserve + drop
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;
const APPLY = process.argv.includes("--apply");

async function columnExists(sql: Sql, table: string, col: string) {
  const r = (await sql.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    [table, col],
  )) as unknown[];
  return r.length > 0;
}

async function count(sql: Sql, where: string): Promise<number> {
  const r = (await sql.query(
    `SELECT count(*)::int AS n FROM wiki_sources WHERE ${where}`,
  )) as Array<{ n: number }>;
  return r[0].n;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  if (!(await columnExists(sql, "wiki_sources", "kind"))) {
    console.log("Column wiki_sources.kind already dropped — nothing to do.");
    return;
  }

  const needPreserve = await count(
    sql,
    "kind IS NOT NULL AND NOT ((metadata #> '{classify,extra}') ? 'legacyKind')",
  );
  console.log(
    `${APPLY ? "Applying" : "Dry run"} · kind column present · ` +
      `${needPreserve} rows need legacyKind preserved`,
  );

  if (!APPLY) {
    console.log(
      "Re-run with --apply to preserve kind → classify.extra.legacyKind and DROP COLUMN kind.",
    );
    return;
  }

  // 1. preserve
  await sql.query(
    `UPDATE wiki_sources
       SET metadata = jsonb_set(metadata, '{classify,extra,legacyKind}', to_jsonb(kind::text), true)
     WHERE kind IS NOT NULL
       AND NOT ((metadata #> '{classify,extra}') ? 'legacyKind')`,
  );

  // 2. safety gate
  const unpreserved = await count(
    sql,
    "kind IS NOT NULL AND (metadata #> '{classify,extra,legacyKind}') IS NULL",
  );
  if (unpreserved > 0) {
    console.error(
      `ABORT: ${unpreserved} rows have a kind not preserved into classify.extra.legacyKind. Column NOT dropped.`,
    );
    process.exit(1);
  }
  console.log("Preserved legacyKind on all rows with a kind value.");

  // 3. drop (irreversible)
  await sql.query("ALTER TABLE wiki_sources DROP COLUMN IF EXISTS kind");
  console.log("Dropped column wiki_sources.kind.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
