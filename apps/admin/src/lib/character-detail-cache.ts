import { revalidateTag, unstable_cache } from "next/cache";
import {
  getCharacterStore,
  getCharacterVersionStore,
  getWikiStore,
  getWikisStore,
  type CharacterRecord,
} from "@odyssey/db";
import type {
  ConfigBinding,
  ConfigWikiOption,
  ConfigVersion,
} from "@/components/character-config";
import { CHARACTERS_LIST_CACHE_TAG } from "./characters-cache";

/* ── Tag contract ─────────────────────────────────────────────────
 *
 * Per-character cache tag. Every mutation route that touches a single
 * character's payload (identity, voice, brain, directive, bindings,
 * versions, thumbnail, ingest) fires `invalidateCharacterDetail(id)`
 * so subsequent navigations to /characters/<slug> serve a fresh copy.
 * The broader `characters-list` cache stays put — list-shape mutations
 * call both helpers.
 */

export const characterDetailTag = (id: string): string =>
  `character-detail:${id}`;

export function invalidateCharacterDetail(id: string): void {
  revalidateTag(characterDetailTag(id), "max");
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── Slug → id resolution (cheap, separate cache) ──────────────────
 *
 * The 404 gate on /characters/[slug] needs the id before it can fetch
 * the payload. Cache it on the same tag the list uses so a create /
 * delete / rename invalidates this too. ~5ms saved per cache hit. */
export const getCharacterIdBySlugOrId = unstable_cache(
  async (slugOrId: string): Promise<string | null> => {
    const store = getCharacterStore();
    if (UUID_RE.test(slugOrId)) {
      const byId = await store.getById(slugOrId);
      if (byId) return byId.id;
    }

    const bySlug = await store.getBySlug(slugOrId);
    if (bySlug) return bySlug.id;

    const byId = await store.getById(slugOrId);
    return byId?.id ?? null;
  },
  ["character-id-by-slug-or-id"],
  { tags: [CHARACTERS_LIST_CACHE_TAG], revalidate: 60 * 60 },
);

export const getCharacterIdBySlug = getCharacterIdBySlugOrId;

/* ── Detail payload ────────────────────────────────────────────────
 *
 * Mirrors the exact server contract /characters/[slug]/page.tsx needs
 * to hand to <CharacterConfig />. Collapses 4 + 4N DB round-trips
 * (where N = number of bound wikis) into one tagged cache entry.
 *
 * Why a factory: `unstable_cache` only accepts a static tags array, so
 * we wrap per-id at call time. The cache identity is determined by
 * `keyParts` (which includes the id), not the function reference, so
 * creating a new wrapper per call doesn't allocate any extra storage.
 */

export type CharacterDetailPayload = {
  character: CharacterRecord;
  knowledge: {
    pageCount: number;
    entityCount: number;
    bindings: ConfigBinding[];
    availableWikis: ConfigWikiOption[];
  };
  versions: ConfigVersion[];
};

function buildCachedDetailFetcher(id: string) {
  return unstable_cache(
    async (): Promise<CharacterDetailPayload | null> => {
      const character = await getCharacterStore().getById(id);
      if (!character) return null;

      const wikis = getWikisStore();
      const wikiStore = getWikiStore();

      const [bindingRows, wikiSummaries, pages, versions] = await Promise.all([
        wikis.listWikisForCharacter(character.id),
        wikis.listWikiSummaries(),
        wikiStore.listPages(character.id),
        getCharacterVersionStore().listForCharacter(character.id),
      ]);

      const availableWikis: ConfigWikiOption[] = await Promise.all(
        wikiSummaries.map(async (wiki) => ({
          id: wiki.id,
          slug: wiki.slug,
          title: wiki.title,
          summary: wiki.summary,
          pageCount: wiki.pageCount,
          sourceCount: wiki.sourceCount,
          characterCount: wiki.characterCount,
          updatedAt: wiki.updatedAt,
          iconData: await wikis.getIconDataForWiki(wiki.id),
        })),
      );
      const wikisById = new Map(availableWikis.map((wiki) => [wiki.id, wiki]));

      const bindings: ConfigBinding[] = bindingRows.map((row) => {
        const wiki = wikisById.get(row.id);
        return {
          binding: row.binding,
          wiki: {
            id: row.id,
            slug: row.slug,
            title: row.title,
            summary: row.summary,
            pageCount: wiki?.pageCount ?? 0,
            sourceCount: wiki?.sourceCount ?? 0,
            characterCount: wiki?.characterCount ?? 1,
            updatedAt: row.updatedAt,
            iconData: wiki?.iconData ?? { nodes: [], edges: [] },
          },
        };
      });

      const entityCount = pages.filter((p) => p.type === "entity").length;

      return {
        character,
        knowledge: {
          pageCount: pages.length,
          entityCount,
          bindings,
          availableWikis,
        },
        versions: versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          createdAt: v.createdAt,
        })),
      };
    },
    ["character-detail-payload", id],
    { tags: [characterDetailTag(id)], revalidate: 60 * 60 },
  );
}

export async function getCharacterDetail(
  id: string,
): Promise<CharacterDetailPayload | null> {
  return buildCachedDetailFetcher(id)();
}
