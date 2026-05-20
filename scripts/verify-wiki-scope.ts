/**
 * Verify that wiki-owned content is actually scoped by wiki_id.
 *
 * Usage:
 *   npx tsx scripts/verify-wiki-scope.ts
 *
 * Exits non-zero when any legacy/null scope or cross-wiki relationship remains.
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { sql } from "drizzle-orm";
import { getDb } from "@odyssey/db";

type Check = {
  label: string;
  query: ReturnType<typeof sql>;
};

type CountRow = { count: number | string | bigint };

const checks: Check[] = [
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

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  const result = await db.execute<CountRow>(query);
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: CountRow[] }).rows ?? []);
  const raw = rows[0]?.count ?? 0;
  return Number(raw);
}

async function main() {
  console.log("[verify-wiki-scope] checking wiki-owned tables");

  let failures = 0;
  for (const check of checks) {
    const n = await count(check.query);
    const ok = n === 0;
    if (!ok) failures += 1;
    console.log(`${ok ? "✓" : "✗"} ${check.label}: ${n}`);
  }

  if (failures > 0) {
    console.error(`\n[verify-wiki-scope] failed ${failures} check(s)`);
    process.exit(1);
  }

  console.log("\n[verify-wiki-scope] all checks passed");
}

main().catch((err) => {
  console.error("[verify-wiki-scope] crashed:", err);
  process.exit(1);
});
