import { notFound } from "next/navigation";
import { getCharacterStore, getWikiStore } from "@odyssey/db";
import { CharacterOverview } from "@/components/character-overview";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export default async function CharacterOverviewPage({ params }: { params: Params }) {
  const { slug } = await params;
  const character = await getCharacterStore().getBySlug(slug);
  if (!character) notFound();

  const wiki = getWikiStore();
  const [pages, edges, sources, runs, voiceIdPages] = await Promise.all([
    wiki.listPages(character.id),
    wiki.listCharacterEdges(character.id),
    wiki.listSources(character.id),
    wiki.listIngestionRuns(character.id, 50),
    wiki.listPages(character.id, { type: "voice_identity" }),
  ]);

  // Event count per era (for the Eras card).
  const eventCountByEra = new Map<string, number>();
  for (const p of pages) {
    if (p.type !== "event" || !p.timeIndex) continue;
    eventCountByEra.set(p.timeIndex.era, (eventCountByEra.get(p.timeIndex.era) ?? 0) + 1);
  }

  const voiceIdPage = voiceIdPages[0] ?? null;

  const lastRun = runs[0] ?? null;
  const status: "live" | "draft" =
    pages.length >= 5 && lastRun?.status === "succeeded" ? "live" : "draft";

  return (
    <CharacterOverview
      character={{
        id: character.id,
        slug: character.slug,
        title: character.title,
        summary: character.summary,
        image: character.image,
        eras: character.eras,
      }}
      stats={{
        pageCount: pages.length,
        edgeCount: edges.length,
        sourceCount: sources.length,
        ingestionCount: runs.length,
        lastIngestAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
        status,
      }}
      eventCountByEra={Object.fromEntries(eventCountByEra)}
      voiceIdentity={
        voiceIdPage
          ? {
              slug: voiceIdPage.slug,
              frontmatter: voiceIdPage.frontmatter as Record<string, unknown>,
            }
          : null
      }
    />
  );
}
