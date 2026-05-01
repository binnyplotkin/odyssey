import { notFound } from "next/navigation";
import { getCharacterStore, getWikiStore } from "@odyssey/db";
import { WikiPageView } from "@/components/wiki-page-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; pageSlug: string }>;
type SearchParams = Promise<{ edit?: string }>;

export default async function WikiPageRoute({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug, pageSlug } = await params;
  const { edit: editParam } = await searchParams;

  const character = await getCharacterStore().getBySlug(slug);
  if (!character) notFound();

  const wiki = getWikiStore();
  const [pages, edges, sources] = await Promise.all([
    wiki.listPages(character.id),
    wiki.listCharacterEdges(character.id),
    wiki.listSources(character.id),
  ]);

  const page = pages.find((p) => p.slug === pageSlug);
  if (!page) notFound();

  const sourceRefs = await wiki.listSourceRefsForPage(page.id);

  return (
    <WikiPageView
      characterId={character.id}
      characterSlug={character.slug}
      characterTitle={character.title}
      eras={character.eras}
      page={page}
      pages={pages}
      edges={edges}
      sources={sources}
      sourceRefs={sourceRefs}
      initialEditing={editParam === "1"}
    />
  );
}
