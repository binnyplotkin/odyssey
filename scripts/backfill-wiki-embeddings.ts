/**
 * Backfill embeddings for existing wiki pages.
 *
 * Reads every row in wiki_pages whose embedding is NULL (or whose
 * embeddingModel doesn't match the current target), embeds title+summary+body
 * with OpenAI text-embedding-3-small, and writes the vector + metadata back.
 *
 * One-time database setup (run BEFORE this script, once per database):
 *   psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
 *   npm run db:push                     # adds embedding column + HNSW index
 *
 * Then run the backfill:
 *   npx tsx scripts/backfill-wiki-embeddings.ts                # dry-run
 *   npx tsx scripts/backfill-wiki-embeddings.ts --apply        # write
 *   npx tsx scripts/backfill-wiki-embeddings.ts --apply --character abraham
 *   npx tsx scripts/backfill-wiki-embeddings.ts --apply --refresh   # re-embed everything
 *
 * Cost is negligible — at $0.02/1M tokens, 100 pages × ~500 tokens = $0.001.
 * Latency is the bottleneck: each call is ~50ms over the network, run
 * sequentially to stay polite to OpenAI rate limits.
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { eq, isNull, or, and } from "drizzle-orm";
import {
  getDb,
  wikiPagesTable,
  getCharacterStore,
  wikiEmbeddingSource,
} from "@odyssey/db";
import { embedText, EMBEDDING_MODEL } from "@odyssey/engine";

const APPLY = process.argv.includes("--apply");
const REFRESH = process.argv.includes("--refresh");
const characterFlagIdx = process.argv.indexOf("--character");
const SCOPE_CHARACTER_SLUG =
  characterFlagIdx >= 0 && process.argv[characterFlagIdx + 1]
    ? process.argv[characterFlagIdx + 1]
    : null;

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required.");
    process.exit(1);
  }
  const db = getDb();
  const characters = getCharacterStore();

  let scopeCharacterId: string | null = null;
  if (SCOPE_CHARACTER_SLUG) {
    const c = await characters.getBySlug(SCOPE_CHARACTER_SLUG);
    if (!c) {
      console.error(`character not found: ${SCOPE_CHARACTER_SLUG}`);
      process.exit(1);
    }
    scopeCharacterId = c.id;
  }

  const filter = REFRESH
    ? scopeCharacterId
      ? eq(wikiPagesTable.characterId, scopeCharacterId)
      : undefined
    : scopeCharacterId
      ? and(
          eq(wikiPagesTable.characterId, scopeCharacterId),
          or(isNull(wikiPagesTable.embedding), isNull(wikiPagesTable.embeddedAt)),
        )
      : or(isNull(wikiPagesTable.embedding), isNull(wikiPagesTable.embeddedAt));

  const rows = await db
    .select({
      id: wikiPagesTable.id,
      characterId: wikiPagesTable.characterId,
      slug: wikiPagesTable.slug,
      title: wikiPagesTable.title,
      summary: wikiPagesTable.summary,
      body: wikiPagesTable.body,
      embeddingModel: wikiPagesTable.embeddingModel,
    })
    .from(wikiPagesTable)
    .where(filter);

  console.log(`found ${rows.length} pages to ${REFRESH ? "re-embed" : "embed"}`);
  if (!APPLY) {
    console.log("(dry-run — pass --apply to write)");
    for (const row of rows.slice(0, 10)) {
      console.log(`  would embed: ${row.slug} (existing model: ${row.embeddingModel ?? "none"})`);
    }
    if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const text = wikiEmbeddingSource(row);
      if (!text) {
        console.log(`  skip ${row.slug} — empty content`);
        continue;
      }
      const vec = await embedText(text);
      if (!vec) {
        failed++;
        console.warn(`  skip ${row.slug} — embedText returned null`);
        continue;
      }
      await db
        .update(wikiPagesTable)
        .set({ embedding: vec, embeddingModel: EMBEDDING_MODEL, embeddedAt: new Date() })
        .where(eq(wikiPagesTable.id, row.id));
      ok++;
      if (ok % 10 === 0) console.log(`  ${ok}/${rows.length}...`);
    } catch (err) {
      failed++;
      console.error(`  fail ${row.slug}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`\ndone: ${ok} embedded, ${failed} failed (out of ${rows.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
