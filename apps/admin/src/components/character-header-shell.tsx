import { notFound } from "next/navigation";
import { getCharacterStore } from "@odyssey/db";
import { CharacterHeader } from "@/components/character-header";

// Async server shell — owns the character lookup so the parent layout can
// stay synchronous. Wrapping THIS in <Suspense> keeps the suspense boundary
// inside the [slug] segment, instead of falling back to the parent
// /characters list loader.

export async function CharacterHeaderShell({ slug }: { slug: string }) {
  const character = await getCharacterStore().getBySlug(slug).catch(() => null);
  const resolved = character
    ? { id: character.id, slug: character.slug, title: character.title }
    : slug === "abraham"
      ? { id: "abraham-fallback", slug: "abraham", title: "Abraham" }
      : null;
  if (!resolved) notFound();

  return <CharacterHeader character={resolved} />;
}
