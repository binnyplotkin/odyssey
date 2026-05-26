import { notFound } from "next/navigation";
import { getCharacterStore } from "@odyssey/db";
import { CharacterHeader } from "@/components/character-header";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Async server shell — owns the character lookup so the parent layout can
// stay synchronous. Wrapping THIS in <Suspense> keeps the suspense boundary
// inside the [slug] segment, instead of falling back to the parent
// /characters list loader.

export async function CharacterHeaderShell({ slug }: { slug: string }) {
  const store = getCharacterStore();
  const character = await (UUID_RE.test(slug)
    ? store.getById(slug).then((byId) => byId ?? store.getBySlug(slug))
    : store.getBySlug(slug).then((bySlug) => bySlug ?? store.getById(slug))
  ).catch(() => null);
  const resolved = character
    ? { id: character.id, slug: character.slug, title: character.title }
    : slug === "abraham"
      ? { id: "abraham-fallback", slug: "abraham", title: "Abraham" }
      : null;
  if (!resolved) notFound();

  return <CharacterHeader character={resolved} />;
}
