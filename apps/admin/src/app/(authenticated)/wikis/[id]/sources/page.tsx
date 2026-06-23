import { notFound } from "next/navigation";
import { getWikiStore, getWikisStore } from "@odyssey/db";
import { parseSourceMetadataFilters } from "@/lib/source-metadata-filters";
import { WikiSourcesView } from "./wiki-sources-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SourcesTab({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const metadataFilters = parseSourceMetadataFilters(await searchParams);

  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) notFound();
  const routeBase = `/wikis/${wiki.id}`;

  const store = getWikiStore();
  const [sources, pages, refs, runs] = await Promise.all([
    store.listSourcesForWiki(wiki.id, metadataFilters),
    store.listPagesForWiki(wiki.id),
    store.listSourceRefsForWiki(wiki.id),
    store.listIngestionRunsForWiki(wiki.id, 100),
  ]);

  return (
    <WikiSourcesView
      wikiId={wiki.id}
      wikiTitle={wiki.title}
      sources={sources}
      pages={pages}
      refs={refs}
      runs={runs}
      routeBase={routeBase}
      metadataFilters={metadataFilters}
    />
  );
}
