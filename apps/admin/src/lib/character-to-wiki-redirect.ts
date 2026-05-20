import "server-only";

import { notFound, redirect } from "next/navigation";
import { getCharacterStore, getWikisStore } from "@odyssey/db";

/**
 * Resolve the wiki id bound to a character (primary > any active > any)
 * for the character/[slug] → /wikis/[id] redirect shims.
 */
export async function resolveWikiIdForCharacter(slug: string): Promise<string> {
  const character = await getCharacterStore().getBySlug(slug);
  if (!character) notFound();

  const bindings = await getWikisStore().listBindingsForCharacter(character.id);
  const primary =
    bindings.find((b) => b.isActive && b.priority === "primary") ??
    bindings.find((b) => b.isActive) ??
    bindings[0];
  if (!primary) notFound();
  return primary.wikiId;
}

/**
 * Redirect a `/characters/[slug]/<segment>` request to the equivalent
 * `/wikis/[wikiId]/<segment>` route, forwarding any search params.
 */
export async function redirectToWiki(
  slug: string,
  segment: string,
  searchParams?: URLSearchParams,
): Promise<never> {
  const wikiId = await resolveWikiIdForCharacter(slug);
  const qs = searchParams?.toString();
  redirect(`/wikis/${wikiId}/${segment}${qs ? `?${qs}` : ""}`);
}
