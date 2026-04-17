import { notFound } from "next/navigation";
import { getCharacterStore, getWikiStore } from "@odyssey/db";
import { CharacterIngestion } from "@/components/character-ingestion";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export default async function IngestionTab({ params }: { params: Params }) {
  const { slug } = await params;
  const character = await getCharacterStore().getBySlug(slug);
  if (!character) notFound();

  const wiki = getWikiStore();
  const [runs, sources] = await Promise.all([
    wiki.listIngestionRuns(character.id, 30),
    wiki.listSources(character.id),
  ]);

  // Week aggregates (from the header line of the recent-runs card in Paper).
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weekRuns = runs.filter((r) => new Date(r.startedAt).getTime() >= weekAgo);
  const weekTokens = weekRuns.reduce((acc, r) => acc + (r.tokensUsed ?? 0), 0);

  // Source lookup for the history row (so we can render the source title).
  const sourceById = new Map(sources.map((s) => [s.id, s] as const));

  return (
    <CharacterIngestion
      characterId={character.id}
      characterSlug={character.slug}
      hasIngestionPrompt={!!(character.ingestionPrompt?.trim())}
      history={runs.map((r) => ({
        id: r.id,
        sourceTitle: r.sourceId ? sourceById.get(r.sourceId)?.title ?? "(deleted source)" : "(inline)",
        sourceKind: r.sourceId ? sourceById.get(r.sourceId)?.kind ?? "unknown" : "unknown",
        sourceTags:
          (r.sourceId ? (sourceById.get(r.sourceId)?.metadata.tags as string[] | undefined) : []) ?? [],
        status: r.status,
        model: r.model,
        pagesCreated: r.pagesCreated,
        pagesUpdated: r.pagesUpdated,
        edgesAdded: r.edgesAdded,
        contradictionsFound: r.contradictionsFound,
        tokensUsed: r.tokensUsed,
        errorMessage: r.errorMessage,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      }))}
      stats={{
        totalRuns: runs.length,
        weekRuns: weekRuns.length,
        weekTokens,
      }}
    />
  );
}
