/**
 * Retrieval grounding diagnostic — why does semantic search return 0 hits?
 *
 * Resolves a character's ACTIVE wikis, embeds a query with both providers, and runs
 * the pgvector search at threshold 0 (no minSimilarity filter) so we can see the RAW
 * top-K cosine similarities. Tells apart the three failure modes:
 *   - no active wikis            → activeWikiIds empty → 0 hits
 *   - empty embedding columns    → 0 hits even at threshold 0
 *   - threshold too high         → hits appear at threshold 0 but below 0.5
 *
 *   EMBEDDING_PROVIDER=openai npx tsx --env-file=.env \
 *     packages/voice-pipeline/scripts/diag-retrieval.ts <characterSlug> "<query>"
 */
import { getCharacterStore, getWikiStore, getWikisStore } from "@odyssey/db";
import { embedText, embedTextLocal } from "@odyssey/engine";

const CHARACTER = process.argv[2] ?? "abraham";
const QUERY = process.argv[3] ?? "Sarah laughed when she heard. Were you afraid to believe the promise?";

async function main() {
  const character =
    (await getCharacterStore().getBySlug(CHARACTER)) ??
    (await getCharacterStore().getById(CHARACTER));
  if (!character) {
    console.error(`character "${CHARACTER}" not found`);
    process.exit(1);
  }

  const wikis = await getWikisStore().listWikisForCharacter(character.id);
  const active = wikis.filter((w) => w.binding.isActive);
  console.log(`character: ${character.title} (${character.slug})`);
  console.log(`query    : "${QUERY}"`);
  console.log(`wikis    : ${wikis.length} total · ${active.length} active`);
  for (const w of wikis) {
    console.log(`  • ${w.id}  active=${w.binding.isActive}  "${(w as { title?: string }).title ?? "?"}"`);
  }
  const activeIds = active.map((w) => w.id);
  if (!activeIds.length) {
    console.log("\n⚠ NO ACTIVE WIKIS → activeWikiIds is empty → semantic search can only return 0.");
    process.exit(0);
  }

  // openai (1536)
  try {
    const oa = await embedText(QUERY);
    console.log(`\nopenai embed: ${oa?.length ?? 0} dims`);
    const oaHits = await getWikiStore().searchPagesByEmbeddingForWikis(activeIds, oa, {
      topK: 10,
      minSimilarity: 0,
    });
    console.log(`openai search @ threshold 0: ${oaHits.length} hits`);
    for (const h of oaHits) console.log(`    ${h.slug}  sim=${h.similarity.toFixed(4)}`);
  } catch (e) {
    console.log(`openai search failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // bge (384)
  try {
    const bg = await embedTextLocal(QUERY, { isQuery: true });
    console.log(`\nbge embed: ${bg?.length ?? 0} dims`);
    const bgHits = await getWikiStore().searchPagesByBgeEmbeddingForWikis(activeIds, bg, {
      topK: 10,
      minSimilarity: 0,
    });
    console.log(`bge search @ threshold 0: ${bgHits.length} hits`);
    for (const h of bgHits) console.log(`    ${h.slug}  sim=${h.similarity.toFixed(4)}`);
  } catch (e) {
    console.log(`bge search failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
