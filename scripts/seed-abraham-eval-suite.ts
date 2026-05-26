/**
 * Seed the Abraham regression suite into eval_suites.
 *
 * The suite is currently defined in TS (`evals/abraham/suite.ts`); this
 * script lifts that into the DB so the harness UI can list / display /
 * (eventually) edit it. The TS file is still the authoring surface — once
 * a version is published into the DB it's immutable; bump `version` in
 * the TS file when probes change, and re-run this script to publish.
 *
 * Idempotent: checks for (character, slug, version) before inserting.
 *
 * Usage:
 *   npx tsx scripts/seed-abraham-eval-suite.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getCharacterStore, getEvalStore } from "@odyssey/db";
import { abrahamSuite } from "../evals/abraham/suite";

async function main() {
  const character = await getCharacterStore().getBySlug("abraham");
  if (!character) {
    console.error("Abraham not found in DB. Run the abraham seed first.");
    process.exit(1);
  }

  const store = getEvalStore();
  const existing = await store.getLatestSuiteBySlug(character.id, abrahamSuite.id);

  if (existing && existing.version === abrahamSuite.version) {
    console.log(
      `Suite ${abrahamSuite.id} v${abrahamSuite.version} already published for Abraham.\n` +
        `  Suite id: ${existing.id}\n` +
        `  Probes:   ${(existing.probes as unknown[]).length}\n` +
        `  Created:  ${existing.createdAt}\n` +
        `\nNothing to do. Bump version in evals/abraham/suite.ts to publish a new one.`,
    );
    return;
  }

  if (existing) {
    console.log(
      `Existing suite is at version ${existing.version}; publishing new ${abrahamSuite.version}.`,
    );
  }

  const created = await store.createSuite({
    characterId: character.id,
    slug: abrahamSuite.id,
    version: abrahamSuite.version,
    probes: abrahamSuite.probes,
    notes: abrahamSuite.label,
  });

  console.log(
    `✓ Published suite\n` +
      `  Suite id: ${created.id}\n` +
      `  Slug:     ${created.slug}\n` +
      `  Version:  ${created.version}\n` +
      `  Probes:   ${(created.probes as unknown[]).length}`,
  );
}

main().catch((err) => {
  console.error("Seed failed:");
  console.error(err);
  process.exit(1);
});
