import { notFound } from "next/navigation";
import { getWikiStore, getWikisStore } from "@odyssey/db";
import { WikiSourcesView } from "./wiki-sources-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ source?: string }>;

export default async function SourcesTab({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { source: initialSourceId } = await searchParams;

  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) notFound();
  const routeBase = `/wikis/${wiki.id}`;

  const store = getWikiStore();
  const [sources, pages, refs, runs] = await Promise.all([
    store.listSourcesForWiki(wiki.id),
    store.listPagesForWiki(wiki.id),
    store.listSourceRefsForWiki(wiki.id),
    store.listIngestionRunsForWiki(wiki.id, 100),
  ]);

  const initial =
    sources.find((s) => s.id === initialSourceId) ?? sources[0] ?? null;

  return (
    <WikiSourcesView
      wikiId={wiki.id}
      sources={sources}
      pages={pages}
      refs={refs}
      runs={runs}
      initialSourceId={initial?.id ?? null}
      routeBase={routeBase}
    />
  );
}
