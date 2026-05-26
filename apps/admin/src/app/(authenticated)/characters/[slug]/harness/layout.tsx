import { notFound } from "next/navigation";
import { getCharacterStore } from "@odyssey/db";
import { HarnessShell } from "@/components/harness/harness-shell";
import { HarnessCharacterProvider } from "@/components/harness/harness-character-context";
import { HarnessLayoutProvider } from "@/components/harness/harness-layout-context";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

/**
 * Layout for everything under `/characters/:slug/harness/*`. Fetches the
 * character once and provides it to nested routes via context — each page
 * then renders its own main-pane content; the shell wraps with sidebar +
 * right rail.
 *
 * Pre-refactor each page would re-fetch the character itself. Lifting it
 * here means the routing transitions don't re-fetch.
 */
export default async function HarnessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Params;
}) {
  const { slug } = await params;
  const store = getCharacterStore();
  const character = (await store.getBySlug(slug)) ?? (await store.getById(slug));
  if (!character) notFound();

  // Trim to the subset the harness components consume — keeps the context
  // payload tight and matches the HarnessCharacter type they expect.
  const harnessCharacter = {
    id: character.id,
    slug: character.slug,
    title: character.title,
    summary: character.summary,
    image: character.image,
    identity: character.identity,
    voiceStyle: character.voiceStyle,
    brainModel: character.brainModel,
    directive: character.directive,
  };

  return (
    <HarnessCharacterProvider character={harnessCharacter}>
      <HarnessLayoutProvider>
        <HarnessShell character={harnessCharacter}>{children}</HarnessShell>
      </HarnessLayoutProvider>
    </HarnessCharacterProvider>
  );
}
