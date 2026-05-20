import { notFound } from "next/navigation";
import { getCharacterStore, getWikisStore } from "@odyssey/db";
import { WikiDetail, type WikiDetailProps } from "./wiki-detail";

export const dynamic = "force-dynamic";

export default async function WikiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const wikis = getWikisStore();
  const characters = getCharacterStore();

  const record = await wikis.getWikiById(id);
  if (!record) notFound();

  const [bindings, allCharacters, pages, sources, runs, edgeCount, iconData] =
    await Promise.all([
      wikis.listBindingsForWiki(record.id),
      characters.list(),
      wikis.listPagesForWiki(record.id),
      wikis.listSourcesForWiki(record.id),
      wikis.listIngestionsForWiki(record.id, 5),
      wikis.countEdgesForWiki(record.id),
      wikis.getIconDataForWiki(record.id),
    ]);

  const boundCharacters: WikiDetailProps["boundCharacters"] = bindings.map(
    (binding) => {
      const character = allCharacters.find((c) => c.id === binding.characterId);
      return {
        binding,
        character: character
          ? {
              id: character.id,
              slug: character.slug,
              title: character.title,
              image: character.image,
            }
          : null,
      };
    },
  );

  return (
    <WikiDetail
      wiki={record}
      boundCharacters={boundCharacters}
      pageCount={pages.length}
      sourceCount={sources.length}
      edgeCount={edgeCount}
      iconData={iconData}
      recentRuns={runs.map((r) => ({
        id: r.id,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        pagesCreated: r.pagesCreated,
        pagesUpdated: r.pagesUpdated,
        edgesAdded: r.edgesAdded,
        tokensUsed: r.tokensUsed,
        model: r.model,
        errorMessage: r.errorMessage,
      }))}
    />
  );
}
