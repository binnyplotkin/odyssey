/**
 * Verify that the DB repository's hydrateCharactersFromGraph produces a valid
 * CharacterDefinition from the backfilled world_nodes.
 *
 * Usage:
 *   npx tsx scripts/inspect-hydrated-world.ts [worldId]
 * Defaults to abrahams-tent-base.
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getWorldRepository } from "@odyssey/db";
import { worldDefinitionSchema } from "@odyssey/types";

async function main() {
  const worldId = process.argv[2] ?? "abrahams-tent-base";
  const repo = getWorldRepository([]);

  const world = await repo.getWorldById(worldId);
  if (!world) {
    console.error(`World ${worldId} not found.`);
    process.exit(1);
  }

  console.log(`World: ${world.id}  "${world.title}"`);
  console.log(`Characters: ${world.characters.length}\n`);

  const wholeParse = worldDefinitionSchema.safeParse(world);
  if (!wholeParse.success) {
    console.log("✗ Full world definition FAILED schema validation:");
    for (const issue of wholeParse.error.issues) {
      console.log(`    · ${issue.path.join(".")}: ${issue.message}`);
    }
  } else {
    console.log("✓ Full world definition passes worldDefinitionSchema.\n");
  }

  for (const c of world.characters) {
    console.log(
      `  · ${c.id} — ${c.name}` +
        (c.archetype ? ` (${c.archetype})` : "") +
        (c.motivations?.length ? `  motivations=${c.motivations.length}` : "") +
        (c.emotionalBaseline
          ? `  emotionalBaseline keys=${Object.keys(c.emotionalBaseline).length}`
          : ""),
    );
  }

  if (world.characters.length > 0) {
    console.log("\nFirst character (full):");
    console.log(JSON.stringify(world.characters[0], null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
