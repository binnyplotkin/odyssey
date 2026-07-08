import { notFound } from "next/navigation";
import { getWikiStore, getWikisStore } from "@odyssey/db";
import { WikiSourceDetailView } from "./wiki-source-detail-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; sourceId: string }>;
type SearchParams = Promise<{ run?: string }>;

export default async function SourceDetailRoute({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id, sourceId } = await params;
  const { run: runParam } = await searchParams;

  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) notFound();
  const routeBase = `/wikis/${wiki.id}`;

  const store = getWikiStore();
  const [source, pages, runs, refs, cites, citedBy, allSources] =
    await Promise.all([
      store.getSource(sourceId),
      store.listPagesForWiki(wiki.id),
      store.listIngestionRunsForWiki(wiki.id, 100),
      store.listSourceRefsForWiki(wiki.id),
      store.listCitationsForCarrier(sourceId),
      store.listCitationsForCited(sourceId),
      store.listSourcesForWiki(wiki.id),
    ]);

  if (!source || source.wikiId !== wiki.id) notFound();

  const sourceRuns = runs.filter((r) => r.sourceId === source.id);
  const sourceRefs = refs.filter((r) => r.sourceId === source.id);
  const activeRun =
    sourceRuns.find((r) => r.id === runParam) ?? sourceRuns[0] ?? null;

  // id → title for rendering citation edges + attributed refs.
  const sourceTitles = Object.fromEntries(
    allSources.map((s) => [s.id, s.title]),
  );

  return (
    <WikiSourceDetailView
      wikiId={wiki.id}
      wikiTitle={wiki.title}
      characterId={source.characterId}
      source={source}
      pages={pages}
      runs={sourceRuns}
      refs={sourceRefs}
      cites={cites}
      citedBy={citedBy}
      sourceTitles={sourceTitles}
      activeRunId={activeRun?.id ?? null}
      routeBase={routeBase}
    />
  );
}
