/**
 * One-off: adopt the sweep winner as Abraham's production preset.
 *
 * Sweep result (.evals/sweeps/abraham/latest.md) picked
 * `sonnet-4-5__t=0.7` as the only config with a perfect 20/20 AND on
 * the Pareto frontier. This script merges that into Abraham's saved
 * brainModel without disturbing any other fields the author may have
 * set (maxTokens, cacheControl, etc.).
 *
 * Usage: npx tsx scripts/adopt-abraham-winner-preset.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getCharacterStore } from "@odyssey/db";

async function main() {
  const store = getCharacterStore();
  const character = await store.getBySlug("abraham");
  if (!character) {
    console.error("Abraham not found in DB. Run the abraham seed first.");
    process.exit(1);
  }

  const current = character.brainModel ?? {};
  console.log("Current brainModel:", JSON.stringify(current, null, 2));

  const next = {
    ...current,
    provider: "anthropic" as const,
    model: "claude-sonnet-4-5",
    temperature: 0.7,
  };

  console.log("\nApplying:", JSON.stringify(next, null, 2));

  const updated = await store.update(character.id, { brainModel: next });
  if (!updated) {
    console.error("Update returned null — character disappeared mid-flight?");
    process.exit(1);
  }

  console.log("\n✓ Saved. Abraham now runs on sonnet-4-5 @ temperature 0.7.");
  console.log("  Sweep evidence: 20/20 passed · avg 4.71/5 · $0.31/run");
}

main().catch((err) => {
  console.error("Failed:");
  console.error(err);
  process.exit(1);
});
