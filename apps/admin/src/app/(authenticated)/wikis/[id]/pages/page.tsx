import { notFound } from "next/navigation";
import { getWikiStore, getWikisStore } from "@odyssey/db";
import { WikiPagesView } from "./wiki-pages-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ page?: string }>;

export default async function WikiTab({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { page: initialPageSlug } = await searchParams;

  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) notFound();
  const routeBase = `/wikis/${wiki.id}`;

  const store = getWikiStore();
  const [pages, edges, sources, allRefs] = await Promise.all([
    store.listPagesForWiki(wiki.id),
    store.listWikiEdges(wiki.id),
    store.listSourcesForWiki(wiki.id),
    store.listSourceRefsForWiki(wiki.id),
  ]);

  let selectedSlug = pages.find((p) => p.slug === initialPageSlug)?.slug ?? null;
  if (!selectedSlug && pages.length > 0) selectedSlug = pages[0].slug;

  return (
    <WikiPagesView
      wikiId={id}
      eras={wiki.eras}
      pages={pages}
      edges={edges}
      sources={sources}
      allSourceRefs={allRefs}
      initialSelectedSlug={selectedSlug}
      routeBase={routeBase}
    />
  );
}
