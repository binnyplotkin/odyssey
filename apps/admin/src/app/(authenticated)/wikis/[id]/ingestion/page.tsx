import { notFound } from "next/navigation";
import { getCharacterStore, getWikiStore, getWikisStore } from "@odyssey/db";
import { WikiIngestionView } from "./wiki-ingestion-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function IngestionTab({ params }: { params: Params }) {
  const { id } = await params;
  const wikis = getWikisStore();
  const wiki = await wikis.getWikiById(id);
  if (!wiki) notFound();

  const bindings = await wikis.listBindingsForWiki(wiki.id);
  const primary =
    bindings.find((b) => b.isActive && b.priority === "primary") ??
    bindings.find((b) => b.isActive) ??
    bindings[0] ??
    null;
  const character = primary
    ? await getCharacterStore().getById(primary.characterId)
    : null;

  const store = getWikiStore();
  const [runs, sources, pages, edges] = await Promise.all([
    store.listIngestionRunsForWiki(wiki.id, 30),
    store.listSourcesForWiki(wiki.id),
    store.listPagesForWiki(wiki.id),
    store.listWikiEdges(wiki.id),
  ]);

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weekRuns = runs.filter(
    (r) => new Date(r.startedAt).getTime() >= weekAgo,
  );
  const weekTokens = weekRuns.reduce((acc, r) => acc + (r.tokensUsed ?? 0), 0);

  const succeeded = runs.filter((r) => r.status === "succeeded").length;
  const successPct =
    runs.length === 0 ? 0 : Math.round((succeeded / runs.length) * 100);

  // Approximate the prompt token count so the pipeline strip + nav badge
  // can show a real value. Cheap heuristic: ~4 chars per token.
  const promptText = wiki.ingestionPrompt ?? "";
  const promptTokens = Math.max(1, Math.round(promptText.length / 4));
  const promptName = wiki.ingestionPromptName ?? null;

  return (
    <WikiIngestionView
      characterId={character?.id ?? null}
      wikiId={wiki.id}
      wikiTitle={wiki.title ?? wiki.slug}
      brain={{
        pageCount: pages.length,
        edgeCount: edges.length,
        sourceCount: sources.length,
        runCount: runs.length,
        successPct,
      }}
      sources={sources}
      runs={runs}
      weekRuns={weekRuns.length}
      weekTokens={weekTokens}
      promptTokens={promptTokens}
      promptText={promptText}
      promptName={promptName}
      promptInherited={false}
      characterName={character?.title ?? character?.slug ?? wiki.title}
      characterBrief={character?.brief ?? null}
    />
  );
}
