import { notFound } from "next/navigation";
import { getWikiStore, getWikisStore } from "@odyssey/db";
import { WikiPageView } from "@/components/wiki-page-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; pageSlug: string }>;
type SearchParams = Promise<{ edit?: string }>;

export default async function WikiPageRoute({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id, pageSlug } = await params;
  const { edit: editParam } = await searchParams;

  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) notFound();
  const routeBase = `/wikis/${wiki.id}`;

  const store = getWikiStore();
  const [pages, edges, sources] = await Promise.all([
    store.listPagesForWiki(wiki.id),
    store.listWikiEdges(wiki.id),
    store.listSourcesForWiki(wiki.id),
  ]);

  const page = pages.find((p) => p.slug === pageSlug);
  if (!page) notFound();

  const sourceRefs = await store.listSourceRefsForPage(page.id);

  return (
      <WikiPageView
      wikiId={wiki.id}
      characterId={page.characterId}
      characterSlug={wiki.slug}
      characterTitle={wiki.title}
      eras={wiki.eras}
      page={page}
      pages={pages}
      edges={edges}
      sources={sources}
      sourceRefs={sourceRefs}
      initialEditing={editParam === "1"}
      routeBase={routeBase}
      pageRouteSegment="pages"
      breadcrumbLabel={`${wiki.title} · Pages`}
    />
  );
}
