import { revalidateTag, unstable_cache } from "next/cache";
import { getCharacterStore, getWikiStore, getWikisStore } from "@odyssey/db";
import type { CharacterSummary } from "@/app/(authenticated)/characters/page";

/** Cache tag every character-mutating path invalidates via
 * `invalidateCharactersList`. Wiki ingestion runs that complete also
 * need to fire this — the list surfaces `lastIngestAt` + `ingestionStatus`
 * + a derived "live | draft" status from the page count. */
export const CHARACTERS_LIST_CACHE_TAG = "characters-list";

/** Purge the cached characters list. Wraps `revalidateTag` so the
 * Next 16+ required `profile` argument lives in one place — see the
 * matching helper in `voices-cache.ts` for why. */
export function invalidateCharactersList(): void {
  revalidateTag(CHARACTERS_LIST_CACHE_TAG, "max");
}

/**
 * Cached list of character summaries — the exact payload the
 * `/characters` index hydrates CharactersGrid with. Each summary needs
 * 5 per-character queries (pages, sources, runs, world count, bindings)
 * to build, so this is the biggest single win in caching this app: a
 * library of 10 characters drops from ~50 DB round-trips to 0 on cache
 * hits. Stays fresh via `revalidateTag(CHARACTERS_LIST_CACHE_TAG)` from
 * every character + wiki + binding mutation route.
 */
export const listCharacterSummaries = unstable_cache(
  async (): Promise<CharacterSummary[]> => {
    const store = getCharacterStore();
    const characters = await store.list();
    const wiki = getWikiStore();
    const wikis = getWikisStore();
    return await Promise.all(
      characters.map(async (c): Promise<CharacterSummary> => {
        const [pages, sources, runs, worldCount, bindings] = await Promise.all(
          [
            wiki.listPages(c.id),
            wiki.listSources(c.id),
            wiki.listIngestionRuns(c.id, 1),
            store.countWorldsFor(c.id),
            wikis.listWikisForCharacter(c.id),
          ],
        );
        const lastRun = runs[0] ?? null;
        // "Live" heuristic: has at least one ingestion + a non-trivial
        // page count. Identical to the heuristic in the page itself
        // before caching was extracted.
        const status: "live" | "draft" =
          pages.length >= 5 && lastRun?.status === "succeeded"
            ? "live"
            : "draft";
        return {
          id: c.id,
          slug: c.slug,
          title: c.title,
          summary: c.summary,
          image: c.image,
          thumbnailColor: c.thumbnailColor,
          identity: c.identity,
          brainModel: c.brainModel,
          voiceStyle: c.voiceStyle,
          eraCount: c.eras.length,
          pageCount: pages.length,
          sourceCount: sources.length,
          worldCount,
          bindingCount: bindings.length,
          lastIngestAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
          ingestionStatus: lastRun?.status ?? null,
          status,
        };
      }),
    );
  },
  ["characters-list-summaries"],
  {
    tags: [CHARACTERS_LIST_CACHE_TAG],
    revalidate: 60 * 60,
  },
);
