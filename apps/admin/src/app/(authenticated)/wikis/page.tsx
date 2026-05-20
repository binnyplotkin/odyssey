import {
  getCharacterStore,
  getWikisStore,
  type KnowledgeGraphData,
  type WikiRecord,
} from "@odyssey/db";
import { WikisList } from "./wikis-list";

export const dynamic = "force-dynamic";

export type WikiListItem = WikiRecord & {
  pageCount: number;
  sourceCount: number;
  /** Characters currently bound to this wiki (any priority, active or not). */
  boundCharacters: Array<{ id: string; slug: string; title: string }>;
  iconData: KnowledgeGraphData;
};

export default async function WikisPage() {
  const wikis = getWikisStore();
  const characters = getCharacterStore();

  const [allWikis, allCharacters] = await Promise.all([
    wikis.listWikis(),
    characters.list(),
  ]);

  // Per-wiki: counts + bindings + icon shape. Avoids the cross-wiki
  // aggregate in listWikiSummaries (which surfaced a Neon serverless quirk
  // on the wiki_edges grouping) and keeps the rendering path uniform with
  // the character config page.
  const items: WikiListItem[] = await Promise.all(
    allWikis.map(async (wiki): Promise<WikiListItem> => {
      const [pages, sources, bindings, iconData] = await Promise.all([
        wikis.listPagesForWiki(wiki.id),
        wikis.listSourcesForWiki(wiki.id),
        wikis.listBindingsForWiki(wiki.id),
        wikis.getIconDataForWiki(wiki.id),
      ]);
      const boundCharacters = bindings
        .map((b) => allCharacters.find((c) => c.id === b.characterId))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({ id: c.id, slug: c.slug, title: c.title }));
      return {
        ...wiki,
        pageCount: pages.length,
        sourceCount: sources.length,
        boundCharacters,
        iconData,
      };
    }),
  );

  return <WikisList wikis={items} />;
}
