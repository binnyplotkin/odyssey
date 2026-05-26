/**
 * Remove the abandoned `abraham · v1.1.0` suite row left behind by
 * the V5 smoke test (it appended "(v5 smoke edit)" to id-tell-me's
 * rubric, which now shadows the legitimate v1.0.0 as "latest published"
 * — see eval CLI output: `db: skipped — Latest published suite is
 * v1.1.0, sweep used v1.0.0`).
 *
 * Run via: `npx tsx scripts/cleanup-smoke-suite.ts`
 *
 * The eval-store doesn't expose `deletePublishedSuite` by design
 * (published suites have historical runs FK-pointing at them); this
 * script uses raw SQL because the v1.1.0 row was never used by any
 * real run — it's safe to drop.
 *
 * After running, the next eval will resume DB writes against v1.0.0.
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  // Find candidate rows first — we should expect exactly one, the smoke
  // test artifact. If there are real runs against v1.1.0, abort.
  const rows = await sql`
    SELECT id, slug, version, published_at, release_notes
    FROM eval_suites
    WHERE slug = 'abraham' AND version = '1.1.0'
  ` as Array<{ id: string; slug: string; version: string; published_at: string | null; release_notes: string | null }>;

  if (rows.length === 0) {
    console.log("Nothing to clean — no abraham v1.1.0 suite found.");
    return;
  }

  console.log(`Found ${rows.length} matching row(s):`);
  for (const r of rows) {
    console.log(`  ${r.id} · published=${r.published_at ?? "(draft)"} · notes=${r.release_notes ?? "(none)"}`);

    // Safety: refuse to drop if any runs FK to it.
    const dependent = await sql`
      SELECT COUNT(*)::int AS n FROM eval_runs WHERE suite_id = ${r.id}
    ` as Array<{ n: number }>;
    const n = dependent[0]?.n ?? 0;
    if (n > 0) {
      console.error(`  ⚠ ABORT: ${n} eval_runs reference this suite. Drop those first if you really mean it.`);
      process.exit(1);
    }
  }

  const deleted = await sql`
    DELETE FROM eval_suites
    WHERE slug = 'abraham' AND version = '1.1.0'
    RETURNING id
  ` as Array<{ id: string }>;

  console.log(`\n✓ Deleted ${deleted.length} row(s).`);
}

main().catch((err) => {
  console.error("Failed:");
  console.error(err);
  process.exit(1);
});
