import { notFound } from "next/navigation";
import { getCharacterStore, getWikiStore } from "@odyssey/db";
import { CharacterChat } from "@/components/character-chat";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export default async function ChatPage({ params }: { params: Params }) {
  const { slug } = await params;
  const character = await getCharacterStore().getBySlug(slug);
  if (!character) notFound();

  // Pre-load the small page inventory so the scene-setup autocomplete works
  // without extra round trips. For large wikis this could page, but at our
  // scale it's a negligible query.
  const wiki = getWikiStore();
  const [pages, edges] = await Promise.all([
    wiki.listPages(character.id),
    wiki.listCharacterEdges(character.id),
  ]);

  return (
    <CharacterChat
      character={{
        id: character.id,
        slug: character.slug,
        title: character.title,
        summary: character.summary,
        image: character.image,
        eras: character.eras,
        // Forwarded so the wavefield (mounted by the Voice tab) can
        // pre-select the L04 voice-mode override when authored.
        brainModel: character.brainModel,
      }}
      pages={pages}
      edges={edges}
    />
  );
}
