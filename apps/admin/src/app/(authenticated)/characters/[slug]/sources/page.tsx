import { notFound } from "next/navigation";
import { getCharacterStore, getWikiStore } from "@odyssey/db";
import { CharacterSources } from "@/components/character-sources";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ source?: string }>;

export default async function SourcesTab({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const { source: initialSourceId } = await searchParams;

  const character = await getCharacterStore().getBySlug(slug);
  if (!character) notFound();

  const wiki = getWikiStore();
  const [sources, pages, refs, runs] = await Promise.all([
    wiki.listSources(character.id),
    wiki.listPages(character.id),
    wiki.listSourceRefsForCharacter(character.id),
    wiki.listIngestionRuns(character.id, 100),
  ]);

  const initial =
    sources.find((s) => s.id === initialSourceId) ?? sources[0] ?? null;

  return (
    <CharacterSources
      characterId={character.id}
      characterSlug={character.slug}
      sources={sources}
      pages={pages}
      refs={refs}
      runs={runs}
      initialSourceId={initial?.id ?? null}
    />
  );
}
