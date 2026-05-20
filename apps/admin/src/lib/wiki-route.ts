import "server-only";

import { notFound } from "next/navigation";
import {
  getCharacterStore,
  getWikisStore,
  type CharacterRecord,
  type WikiRecord,
} from "@odyssey/db";

/**
 * Resolve a wiki + the character used to back its editor views during the
 * Phase 2b transition.
 *
 * Wiki content (pages/edges/sources/ingestion) is currently still loaded
 * and mutated via the per-character wiki-store. To render wiki-rooted
 * editors at `/wikis/[id]/...` without rewriting that path, we pick the
 * primary active binding's character and proxy through it.
 *
 * Returns 404 when the wiki, its bindings, or the bound character are
 * missing.
 */
export async function resolveWikiWithPrimaryCharacter(
  wikiId: string,
): Promise<{
  wiki: WikiRecord;
  character: CharacterRecord;
  routeBase: string;
}> {
  const wikis = getWikisStore();
  const wiki = await wikis.getWikiById(wikiId);
  if (!wiki) notFound();

  const bindings = await wikis.listBindingsForWiki(wiki.id);
  const primary =
    bindings.find((b) => b.isActive && b.priority === "primary") ??
    bindings.find((b) => b.isActive) ??
    bindings[0];
  if (!primary) notFound();

  const character = await getCharacterStore().getById(primary.characterId);
  if (!character) notFound();

  return { wiki, character, routeBase: `/wikis/${wiki.id}` };
}
