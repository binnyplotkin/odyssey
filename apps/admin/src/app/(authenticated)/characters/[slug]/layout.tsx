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
  const character = await getCharacterStore().getBySlug(slug);
  if (!character) notFound();

  return (
    <>
      <CharacterHeader character={{ id: character.id, slug: character.slug, title: character.title }} />
      {children}
    </>
  );
}
