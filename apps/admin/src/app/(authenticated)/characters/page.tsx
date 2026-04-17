import { getCharacterStore, getWikiStore } from "@odyssey/db";
import { CharactersGrid } from "@/components/characters-grid";

export const dynamic = "force-dynamic";

export type CharacterSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  eraCount: number;
  pageCount: number;
  sourceCount: number;
  lastIngestAt: string | null;
  ingestionStatus: "succeeded" | "failed" | "running" | null;
  status: "live" | "draft";
};

export default async function CharactersPage() {
  const characters = await getCharacterStore().list();
  const wiki = getWikiStore();

  // Aggregate per-character counts + last ingest in parallel.
  const summaries: CharacterSummary[] = await Promise.all(
    characters.map(async (c): Promise<CharacterSummary> => {
      const [pages, sources, runs] = await Promise.all([
        wiki.listPages(c.id),
        wiki.listSources(c.id),
        wiki.listIngestionRuns(c.id, 1),
      ]);
      const lastRun = runs[0] ?? null;
      // "Live" heuristic: has at least one ingestion and a non-trivial page count.
      const status: "live" | "draft" =
        pages.length >= 5 && lastRun?.status === "succeeded" ? "live" : "draft";
      return {
        id: c.id,
        slug: c.slug,
        title: c.title,
        summary: c.summary,
        image: c.image,
        eraCount: c.eras.length,
        pageCount: pages.length,
        sourceCount: sources.length,
        lastIngestAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
        ingestionStatus: lastRun?.status ?? null,
        status,
      };
    }),
  );

  return <CharactersGrid characters={summaries} />;
}
