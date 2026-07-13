import "dotenv/config";
import { getCharacterStore } from "@odyssey/db";

/**
 * One-off cleanup: null out the retired `directive.scope.engage` list on
 * every character. The compiler no longer emits <engage> and the directive
 * API no longer persists it, so this only removes dead data — but it DOES
 * change the cached prompt envelope for characters that still carried the
 * stale list (their prompt-cache entries re-warm on the next turn).
 *
 * Dry-run by default; pass --apply to write.
 *
 *   npx tsx scripts/cleanup-engage-scope.ts          # report only
 *   npx tsx scripts/cleanup-engage-scope.ts --apply  # persist the cleanup
 */

async function main() {
  const apply = process.argv.includes("--apply");
  const store = getCharacterStore();
  const characters = await store.list();

  let stale = 0;
  for (const character of characters) {
    const scope = character.directive?.scope;
    if (!scope?.engage?.length) continue;
    stale += 1;
    console.log(
      `${apply ? "cleaning" : "would clean"} ${character.slug} — ${scope.engage.length} engage item(s)`,
    );
    if (!apply) continue;

    const { engage: _engage, ...restScope } = scope;
    const directive = { ...character.directive };
    if (restScope.refuse?.length) {
      directive.scope = restScope;
    } else {
      delete directive.scope;
    }
    await store.update(character.id, { directive });
  }

  console.log(
    stale === 0
      ? "No characters carry stale engage data."
      : `${stale} character(s) ${apply ? "cleaned" : "with stale engage data (re-run with --apply to clean)"}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
