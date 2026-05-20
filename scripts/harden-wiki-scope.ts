/**
 * Harden wiki-owned tables after migrating legacy character-scoped rows.
 *
 * Usage:
 *   npx tsx scripts/harden-wiki-scope.ts          # dry run
 *   npx tsx scripts/harden-wiki-scope.ts --apply  # mutate schema
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { sql } from "drizzle-orm";
import { getDb } from "@odyssey/db";

type CountRow = { count: number | string | bigint };

const checks = [
  {
    label: "wiki_pages without wiki_id",
    query: sql`SELECT COUNT(*)::int AS count FROM wiki_pages WHERE wiki_id IS NULL`,
  },
  {
    label: "wiki_edges without wiki_id",
    query: sql`SELECT COUNT(*)::int AS count FROM wiki_edges WHERE wiki_id IS NULL`,
  },
  {
    label: "wiki_sources without wiki_id",
    query: sql`SELECT COUNT(*)::int AS count FROM wiki_sources WHERE wiki_id IS NULL`,
  },
  {
    label: "wiki_ingestion_log without wiki_id",
    query: sql`SELECT COUNT(*)::int AS count FROM wiki_ingestion_log WHERE wiki_id IS NULL`,
  },
  {
    label: "duplicate page slugs within a wiki",
    query: sql`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT wiki_id, slug
        FROM wiki_pages
        GROUP BY wiki_id, slug
        HAVING COUNT(*) > 1
      ) dupes
    `,
  },
  {
    label: "edges whose wiki_id differs from source/target pages",
    query: sql`
      SELECT COUNT(*)::int AS count
      FROM wiki_edges e
      JOIN wiki_pages fp ON fp.id = e.from_page_id
      JOIN wiki_pages tp ON tp.id = e.to_page_id
      WHERE e.wiki_id IS DISTINCT FROM fp.wiki_id
         OR e.wiki_id IS DISTINCT FROM tp.wiki_id
    `,
  },
  {
    label: "source refs whose page/source wiki_id differs",
    query: sql`
      SELECT COUNT(*)::int AS count
      FROM wiki_source_refs r
      JOIN wiki_pages p ON p.id = r.page_id
      JOIN wiki_sources s ON s.id = r.source_id
      WHERE p.wiki_id IS DISTINCT FROM s.wiki_id
    `,
  },
  {
    label: "ingestion logs whose source wiki_id differs",
    query: sql`
      SELECT COUNT(*)::int AS count
      FROM wiki_ingestion_log l
      JOIN wiki_sources s ON s.id = l.source_id
      WHERE l.wiki_id IS DISTINCT FROM s.wiki_id
    `,
  },
];

const mutations = [
  sql`CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_wiki_slug_idx ON wiki_pages (wiki_id, slug)`,
  sql`ALTER TABLE wiki_pages ALTER COLUMN wiki_id SET NOT NULL`,
  sql`ALTER TABLE wiki_edges ALTER COLUMN wiki_id SET NOT NULL`,
  sql`ALTER TABLE wiki_sources ALTER COLUMN wiki_id SET NOT NULL`,
  sql`ALTER TABLE wiki_ingestion_log ALTER COLUMN wiki_id SET NOT NULL`,
];

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  const result = await db.execute<CountRow>(query);
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: CountRow[] }).rows ?? []);
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");

  console.log(`[harden-wiki-scope] ${apply ? "apply" : "dry run"}`);

  let failed = false;
  for (const check of checks) {
    const n = await count(check.query);
    const ok = n === 0;
    if (!ok) failed = true;
    console.log(`${ok ? "✓" : "✗"} ${check.label}: ${n}`);
  }

  if (failed) {
    console.error("\n[harden-wiki-scope] refusing to apply constraints until checks pass");
    process.exit(1);
  }

  if (!apply) {
    console.log("\n[harden-wiki-scope] checks passed; rerun with --apply to mutate schema");
    return;
  }

  for (const mutation of mutations) {
    await db.execute(mutation);
  }
  console.log("\n[harden-wiki-scope] constraints applied");
}

main().catch((err) => {
  console.error("[harden-wiki-scope] crashed:", err);
  process.exit(1);
});
