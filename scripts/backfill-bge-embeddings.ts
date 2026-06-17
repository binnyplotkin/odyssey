/**
 * Move 01 backfill — populate wiki_pages.embedding_bge with the co-located
 * bge-small embedder, alongside the existing OpenAI embedding(1536) column.
 *
 * Non-destructive: only writes the new column. Idempotent — re-running
 * re-embeds. Scope to one character (--character <slug>) to validate the A/B,
 * or run for every character before promoting bge to the default.
 *
 *   npx tsx scripts/backfill-bge-embeddings.ts --character abraham
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

function readFlag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function pageText(p: WikiPageRecord): string {
  try {
    const t = wikiEmbeddingSource(p as never);
    if (typeof t === "string" && t.trim()) return t;
  } catch {
    /* fall through to a minimal source */
  }
  return `${p.title ?? p.slug}`;
}

async function main() {
  const slug = readFlag("--character") ?? "abraham";
  const db = getDb();
  if (!db) throw new Error("no DATABASE_URL / db handle");

  const character = await getCharacterStore().getBySlug(slug);
  if (!character) throw new Error(`character not found: ${slug}`);

  const wikis = (await getWikisStore().listWikisForCharacter(character.id)).filter(
    (w) => w.binding.isActive,
  );
  const pages = (await Promise.all(wikis.map((w) => getWikiStore().listPagesForWiki(w.id)))).flat();
  console.log(`${slug} · ${pages.length} pages across ${wikis.length} active wiki(s) · embedder=${LOCAL_EMBEDDING_MODEL}`);

  const t0 = performance.now();
  let written = 0;
  let skipped = 0;
  for (const page of pages) {
    const vec = await embedTextLocal(pageText(page)); // passage (no query prefix)
    if (!vec) {
      skipped += 1;
      continue;
    }
    const literal = `[${vec.join(",")}]`;
    await db.execute(
      sql`UPDATE wiki_pages
          SET embedding_bge = ${literal}::vector(384),
              embedding_bge_model = ${LOCAL_EMBEDDING_MODEL},
              embedding_bge_at = now()
          WHERE id = ${page.id}`,
    );
    written += 1;
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`backfilled ${written} pages (${skipped} skipped) in ${ms}ms · ${(ms / Math.max(1, written)).toFixed(0)}ms/page incl. embed`);

  const check = (await db.execute(
    sql`SELECT count(*)::int AS n FROM wiki_pages
        WHERE character_id = ${character.id} AND embedding_bge IS NOT NULL`,
  )) as unknown as { rows?: Array<{ n: number }> };
  const n = check.rows?.[0]?.n ?? (check as unknown as Array<{ n: number }>)[0]?.n;
  console.log(`verify · ${n} pages now have embedding_bge for ${slug}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
