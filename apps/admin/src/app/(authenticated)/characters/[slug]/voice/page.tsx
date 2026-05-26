import { notFound } from "next/navigation";
import { getCharacterStore } from "@odyssey/db";
import { CharacterVoiceWavefield } from "@/components/character-voice-wavefield";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export default async function CharacterVoicePage({ params }: { params: Params }) {
  const { slug } = await params;
  const character = await getCharacterStore().getBySlug(slug);
  const fallbackAbraham =
    slug === "abraham"
      ? {
          id: "abraham-fallback",
          slug: "abraham",
          title: "Abraham",
          image: null,
          eras: [],
        }
      : null;
  const resolved = character
    ? {
        id: character.id,
        slug: character.slug,
        title: character.title,
        image: character.image,
        eras: character.eras,
        // Pass the L04 Brain/Model so the wavefield can pre-select the
        // author's pinned voice model. Falls through to DEFAULT_VOICE_MODEL
        // when the character has no preference.
        brainModel: character.brainModel,
      }
    : fallbackAbraham;
  if (!resolved) notFound();

  return (
    <CharacterVoiceWavefield
      character={resolved}
    />
  );
}
