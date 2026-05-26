import { notFound } from "next/navigation";
import { getWikiStore, getWikisStore } from "@odyssey/db";
import { WikiSourcesView } from "./wiki-sources-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function SourcesTab({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;

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

  return (
    <WikiSourcesView
      wikiId={wiki.id}
      wikiTitle={wiki.title}
      sources={sources}
      pages={pages}
      refs={refs}
      runs={runs}
      routeBase={routeBase}
    />
  );
}
