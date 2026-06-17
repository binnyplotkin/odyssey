/**
 * Move 01 backfill — populate wiki_pages.embedding_bge with the co-located
 * bge-small embedder, alongside the existing OpenAI embedding(1536) column.
 *
 * Non-destructive: only writes the new column. Skips pages that already have
 * embedding_bge (idempotent / resumable) unless --force. Scope to one
 * character (--character <slug>) or every wiki (--all, required before
 * promoting bge to the default retrieval path).
 *
 *   npx tsx scripts/backfill-bge-embeddings.ts --character abraham
 *   npx tsx scripts/backfill-bge-embeddings.ts --all
 */
import * as dotenv from "dotenv";
dotenv.config({ override: true, quiet: true });

import {
  getCharacterStore,
  getWikisStore,
  getWikiStore,
  getDb,
  wikiEmbeddingSource,
  type WikiPageRecord,
} from "@odyssey/db";
import { embedTextLocal, LOCAL_EMBEDDING_MODEL } from "@odyssey/engine";
import { sql } from "drizzle-orm";

const readFlag = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const hasFlag = (name: string): boolean => process.argv.includes(name);

function pageText(p: WikiPageRecord): string {
  try {
    const t = wikiEmbeddingSource(p as never);
    if (typeof t === "string" && t.trim()) return t;
  } catch {
    /* fall through */
  }
  return `${p.title ?? p.slug}`;
}

async function targetWikiIds(): Promise<string[]> {
  const db = getDb();
  if (!db) throw new Error("no DATABASE_URL / db handle");
  if (hasFlag("--all")) {
    const r = (await db.execute(
      sql`SELECT DISTINCT wiki_id FROM wiki_pages WHERE wiki_id IS NOT NULL`,
    )) as unknown as { rows?: Array<{ wiki_id: string }> };
    const rows = r.rows ?? (r as unknown as Array<{ wiki_id: string }>);
    return rows.map((x) => x.wiki_id);
  }
  const slug = readFlag("--character") ?? "abraham";
  const ch = await getCharacterStore().getBySlug(slug);
  if (!ch) throw new Error(`character not found: ${slug}`);
  return (await getWikisStore().listWikisForCharacter(ch.id))
    .filter((w) => w.binding.isActive)
    .map((w) => w.id);
}

async function main() {
  const db = getDb();
  if (!db) throw new Error("no DATABASE_URL / db handle");
  const force = hasFlag("--force");

  const wikiIds = await targetWikiIds();
  let pages = (await Promise.all(wikiIds.map((w) => getWikiStore().listPagesForWiki(w)))).flat();

  if (!force) {
    const r = (await db.execute(
      sql`SELECT id FROM wiki_pages WHERE embedding_bge IS NOT NULL`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const done = new Set((r.rows ?? (r as unknown as Array<{ id: string }>)).map((x) => x.id));
    const before = pages.length;
    pages = pages.filter((p) => !done.has(p.id));
    console.log(`scope: ${wikiIds.length} wiki(s) · ${before} pages · ${before - pages.length} already done · ${pages.length} to embed · ${LOCAL_EMBEDDING_MODEL}`);
  } else {
    console.log(`scope: ${wikiIds.length} wiki(s) · ${pages.length} pages (force re-embed) · ${LOCAL_EMBEDDING_MODEL}`);
  }

  const t0 = performance.now();
  let written = 0;
  for (const page of pages) {
    const vec = await embedTextLocal(pageText(page)); // passage (no query prefix)
    if (!vec) continue;
    await db.execute(
      sql`UPDATE wiki_pages
          SET embedding_bge = ${`[${vec.join(",")}]`}::vector(384),
              embedding_bge_model = ${LOCAL_EMBEDDING_MODEL},
              embedding_bge_at = now()
          WHERE id = ${page.id}`,
    );
    written += 1;
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`backfilled ${written} pages in ${ms}ms${written ? ` · ${(ms / written).toFixed(0)}ms/page` : ""}`);

  const check = (await db.execute(
    sql`SELECT count(*)::int AS done, count(*) FILTER (WHERE embedding_bge IS NULL)::int AS remaining FROM wiki_pages`,
  )) as unknown as { rows?: Array<{ done: number; remaining: number }> };
  const row = (check.rows ?? (check as unknown as Array<{ done: number; remaining: number }>))[0];
  console.log(`verify · ${row.done} pages with embedding_bge · ${row.remaining} remaining`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
