import {
  getCharacterStore,
  getWikiStore,
  getWikisStore,
  type CharacterBrainModel,
  type CharacterIdentity,
  type CharacterVoiceStyle,
} from "@odyssey/db";
import { CharactersGrid } from "@/components/characters-grid";

export const dynamic = "force-dynamic";

export type CharacterSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  thumbnailColor: string | null;
  identity: CharacterIdentity | null;
  brainModel: CharacterBrainModel | null;
  voiceStyle: CharacterVoiceStyle | null;
  eraCount: number;
  pageCount: number;
  sourceCount: number;
  worldCount: number;
  bindingCount: number;
  lastIngestAt: string | null;
  ingestionStatus: "succeeded" | "failed" | "running" | "queued" | "canceled" | null;
  status: "live" | "draft";
};

export default async function CharactersPage() {
  const store = getCharacterStore();
  const characters = await store.list();
  const wiki = getWikiStore();
  const wikis = getWikisStore();

  // Aggregate per-character counts + last ingest in parallel.
  const summaries: CharacterSummary[] = await Promise.all(
    characters.map(async (c): Promise<CharacterSummary> => {
      const [pages, sources, runs, worldCount, bindings] = await Promise.all([
        wiki.listPages(c.id),
        wiki.listSources(c.id),
        wiki.listIngestionRuns(c.id, 1),
        store.countWorldsFor(c.id),
        wikis.listWikisForCharacter(c.id),
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
        thumbnailColor: c.thumbnailColor,
        identity: c.identity,
        brainModel: c.brainModel,
        voiceStyle: c.voiceStyle,
        eraCount: c.eras.length,
        pageCount: pages.length,
        sourceCount: sources.length,
        worldCount,
        bindingCount: bindings.length,
        lastIngestAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
        ingestionStatus: lastRun?.status ?? null,
        status,
      };
    }),
  );

  return <CharactersGrid characters={summaries} />;
}
