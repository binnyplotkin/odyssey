/**
 * Stage 1 of the `wiki_sources.kind` → `sourceType` collapse.
 *
 * `sourceType` (primary/secondary/tertiary) is now the classifier, stored in the
 * typed `metadata.classify.provenance`. `kind` is a derived legacy shadow. This
 * migration drops the NOT NULL constraint on the column so writes are no longer
 * required to populate it — the reversible first step before the column is
 * dropped entirely (a later migration, once nothing reads `kind`).
 *
 * Usage:
 *   npx tsx scripts/migrate-source-kind-nullable.ts
 *
 * Idempotent — DROP NOT NULL is a no-op if already relaxed.
 *
 * NOT YET RUN against any environment.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [
  `ALTER TABLE wiki_sources ALTER COLUMN kind DROP NOT NULL`,
  // Later stage (after backfill + no readers): ALTER TABLE wiki_sources DROP COLUMN kind;
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
      await sql.query(stmt);
      console.log("ok");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log("FAIL");
      console.error(msg);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${DDL.length} DDL statement(s) executed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
