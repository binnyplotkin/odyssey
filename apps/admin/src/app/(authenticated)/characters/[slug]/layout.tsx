import { notFound } from "next/navigation";
import { getCharacterStore } from "@odyssey/db";
import { CharacterHeader } from "@/components/character-header";

type Params = Promise<{ slug: string }>;

export default async function CharacterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Params;
}) {
  const { slug } = await params;
  const character = await getCharacterStore().getBySlug(slug).catch(() => null);
  const resolved = character
    ? { id: character.id, slug: character.slug, title: character.title }
    : slug === "abraham"
      ? { id: "abraham-fallback", slug: "abraham", title: "Abraham" }
      : null;
  if (!resolved) notFound();

  return (
    <>
      <CharacterHeader character={resolved} />
      {children}
    </>
  );
}
