/**
 * Layer 1.5 loader — assemble the engine-provided wiki context block from
 * structured data (eras on the wiki record, bound characters via bindings).
 *
 * Shared by the ingestion pipeline (every planner/writer call) and the
 * prompt-generation endpoint (so the generator sees exactly what the
 * downstream models will see).
 */

import { getCharacterStore, getWikisStore, type WikiRecord } from "@odyssey/db";
import { renderWikiContext } from "./prompts";

const BINDING_PRIORITY_ORDER: Record<string, number> = {
  primary: 0,
  secondary: 1,
  reference: 2,
};

/**
 * Render the structured facts the engine already knows about this wiki
 * (eras, bound characters) into a system-prompt block. Constant across
 * every call in a run, so it costs one render and stays prompt-cache-friendly.
 * Never fatal: callers proceed without character context if the lookups
 * fail (eras come from the wiki record itself, so they always survive).
 */
export async function loadWikiContext(wikiRecord: WikiRecord): Promise<string> {
  let characters: Array<{
    title: string;
    summary: string | null;
    priority: string;
  }> = [];
  try {
    const bindings = (await getWikisStore().listBindingsForWiki(wikiRecord.id))
      .filter((b) => b.isActive)
      .sort(
        (a, b) =>
          (BINDING_PRIORITY_ORDER[a.priority] ?? 9) -
          (BINDING_PRIORITY_ORDER[b.priority] ?? 9),
      );
    const characterStore = getCharacterStore();
    const loaded = await Promise.all(
      bindings.map(async (binding) => {
        const character = await characterStore.getById(binding.characterId);
        return character
          ? {
              title: character.title,
              summary: character.summary,
              priority: binding.priority,
            }
          : null;
      }),
    );
    characters = loaded.filter((c): c is NonNullable<typeof c> => c !== null);
  } catch (error) {
    console.error(
      "[wiki-ingest] failed to load bound characters for wiki context; continuing without them",
      error,
    );
  }

  return renderWikiContext({
    wikiTitle: wikiRecord.title,
    wikiSummary: wikiRecord.summary,
    eras: wikiRecord.eras,
    characters,
  });
}
