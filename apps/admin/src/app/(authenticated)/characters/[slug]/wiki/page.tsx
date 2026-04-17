import { notFound } from "next/navigation";
import { getCharacterStore, getWikiStore } from "@odyssey/db";
import { CharacterWiki } from "@/components/character-wiki";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ page?: string }>;

export default async function WikiTab({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const { page: initialPageSlug } = await searchParams;

  const character = await getCharacterStore().getBySlug(slug);
  if (!character) notFound();

  const wiki = getWikiStore();
  const [pages, edges, sources] = await Promise.all([
    wiki.listPages(character.id),
    wiki.listCharacterEdges(character.id),
    wiki.listSources(character.id),
  ]);

  // Decide which page the client should start focused on.
  let selectedPage = pages.find((p) => p.slug === initialPageSlug) ?? null;
  if (!selectedPage && pages.length > 0) selectedPage = pages[0];

  // Prefetch source refs for the initially-selected page (keeps first paint fast).
  const initialSourceRefs = selectedPage
    ? await wiki.listSourceRefsForPage(selectedPage.id)
    : [];

  return (
    <CharacterWiki
      characterSlug={character.slug}
      eras={character.eras}
      pages={pages}
      edges={edges}
      sources={sources}
      initialSelectedSlug={selectedPage?.slug ?? null}
      initialSourceRefs={initialSourceRefs}
    />
  );
}
