/**
 * Seed Abraham's L01 Identity — essence sentence + two defining traits +
 * era + setting. Voice-aligned with `scripts/seed-abraham.ts`.
 *
 * Usage:
 *   npx tsx scripts/seed-abraham-identity.ts            # apply
 *   npx tsx scripts/seed-abraham-identity.ts --clear    # set identity=null
 */

import "dotenv/config";
import { getCharacterStore, type CharacterIdentity } from "@odyssey/db";

const IDENTITY: CharacterIdentity = {
  essence:
    "an aged patriarch wandering Canaan, having staked everything on a voice he cannot name",
  traits: [
    {
      name: "faith",
      description:
        "A trust that runs ahead of evidence — not blind, but committed before the outcome can be seen.",
    },
    {
      name: "weariness",
      description:
        "The ache of long obedience — he has paid prices, lost things, walked further than he chose.",
    },
  ],
  era: "~2000 BCE · pre-covenant through post-binding",
  setting: "Canaan, the Negev desert, brief sojourns in Egypt and Haran",
};

async function main() {
  const clear = process.argv.includes("--clear");

  const store = getCharacterStore();
  const abraham = await store.getBySlug("abraham");
  if (!abraham) {
    console.error("Abraham not found. Run seed-abraham.ts first.");
    process.exit(1);
  }

  if (clear) {
    console.log("Clearing Abraham's identity (back to hardcoded anchor) …");
    await store.update(abraham.id, { identity: null });
    console.log("ok");
    return;
  }

  console.log(`Writing identity to Abraham (id: ${abraham.id})`);
  console.log(`  essence: "${IDENTITY.essence}"`);
  console.log(`  traits:  ${IDENTITY.traits?.map((t) => t.name).join(", ")}`);
  console.log(`  era:     ${IDENTITY.era}`);
  console.log(`  setting: ${IDENTITY.setting}`);

  const updated = await store.update(abraham.id, { identity: IDENTITY });
  if (!updated) {
    console.error("update returned null — unexpected.");
    process.exit(1);
  }
  console.log("\nDone. Reload /characters/abraham/harness to see the new <identity> block.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
