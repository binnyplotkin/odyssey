/**
 * Nested provenance P1 — additive schema migration (docs/nested-provenance-spec.md).
 *
 *   1. wiki_sources.content + content_hash → DROP NOT NULL (stub sources are
 *      citation-only rows with no content until hydrated in P2).
 *   2. CREATE TABLE wiki_source_citations (carrier → cited edges).
 *   3. wiki_source_refs + attributed_source_id (nullable FK, ON DELETE SET NULL —
 *      losing a stub degrades attribution, never evidence).
 *
 * Fully additive + idempotent: no data is touched, every step checks current
 * state first. Existing rows/queries are unaffected (all current sources have
 * content; nothing writes stubs or attribution until pipeline steps land).
 *
 * Usage:
 *   npx tsx scripts/migrate-nested-provenance-p1.ts            # dry run (default)
 *   npx tsx scripts/migrate-nested-provenance-p1.ts --apply    # apply
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;
const APPLY = process.argv.includes("--apply");

async function isNullable(sql: Sql, table: string, col: string) {
  const r = (await sql.query(
    "SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    [table, col],
  )) as Array<{ is_nullable: string }>;
  if (r.length === 0) throw new Error(`column ${table}.${col} not found`);
  return r[0].is_nullable === "YES";
}

async function columnExists(sql: Sql, table: string, col: string) {
  const r = (await sql.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    [table, col],
  )) as unknown[];
  return r.length > 0;
}

async function tableExists(sql: Sql, table: string) {
  const r = (await sql.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = $1",
    [table],
  )) as unknown[];
  return r.length > 0;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);
  const steps: string[] = [];

  // ── 1. content / content_hash nullable ─────────────────────────
  for (const col of ["content", "content_hash"]) {
    if (await isNullable(sql, "wiki_sources", col)) {
      console.log(`1. wiki_sources.${col} — already nullable, skip`);
    } else {
      steps.push(`ALTER TABLE wiki_sources ALTER COLUMN ${col} DROP NOT NULL`);
      console.log(`1. wiki_sources.${col} — will DROP NOT NULL`);
    }
  }

  // ── 2. wiki_source_citations ────────────────────────────────────
  if (await tableExists(sql, "wiki_source_citations")) {
    console.log("2. wiki_source_citations — already exists, skip");
  } else {
    steps.push(
      `CREATE TABLE wiki_source_citations (
        id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        carrier_id text NOT NULL REFERENCES wiki_sources(id) ON DELETE CASCADE,
        cited_id text NOT NULL REFERENCES wiki_sources(id) ON DELETE CASCADE,
        marker text,
        raw_citation text,
        locator text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX wiki_source_citations_carrier_idx ON wiki_source_citations (carrier_id)`,
      `CREATE INDEX wiki_source_citations_cited_idx ON wiki_source_citations (cited_id)`,
      // NULLS NOT DISTINCT so (carrier, cited, NULL-marker) can't duplicate either.
      `CREATE UNIQUE INDEX wiki_source_citations_unique_idx ON wiki_source_citations (carrier_id, cited_id, marker) NULLS NOT DISTINCT`,
    );
    console.log("2. wiki_source_citations — will CREATE (+3 indexes)");
  }

  // ── 3. wiki_source_refs.attributed_source_id ───────────────────
  if (await columnExists(sql, "wiki_source_refs", "attributed_source_id")) {
    console.log("3. attributed_source_id — already exists, skip");
  } else {
    steps.push(
      `ALTER TABLE wiki_source_refs ADD COLUMN attributed_source_id text REFERENCES wiki_sources(id) ON DELETE SET NULL`,
      `CREATE INDEX wiki_source_refs_attributed_idx ON wiki_source_refs (attributed_source_id)`,
    );
    console.log("3. attributed_source_id — will ADD COLUMN (+index)");
  }

  if (steps.length === 0) {
    console.log("\nNothing to do — migration already applied.");
    return;
  }
  if (!APPLY) {
    console.log(`\nDry run · ${steps.length} statements pending. Re-run with --apply.`);
    return;
  }

  for (const stmt of steps) {
    await sql.query(stmt);
  }

  // ── Verify ──────────────────────────────────────────────────────
  const ok =
    (await isNullable(sql, "wiki_sources", "content")) &&
    (await isNullable(sql, "wiki_sources", "content_hash")) &&
    (await tableExists(sql, "wiki_source_citations")) &&
    (await columnExists(sql, "wiki_source_refs", "attributed_source_id"));
  console.log(`\nApplied ${steps.length} statements · verify: ${ok ? "OK" : "FAILED"}`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
