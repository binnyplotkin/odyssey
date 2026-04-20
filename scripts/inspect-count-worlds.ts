import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getCharacterStore } from "@odyssey/db";

async function main() {
  const store = getCharacterStore();
  const chars = await store.list();
  console.log(`${chars.length} global character(s):`);
  for (const c of chars) {
    const n = await store.countWorldsFor(c.id);
    console.log(`  · ${c.slug} (${c.title})  worlds=${n}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
