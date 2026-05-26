/**
 * Seed the Sarah character — upserts the character record so the scene
 * orchestrator can route turns to her. Mirrors seed-abraham.ts but smaller
 * in scope: this script only creates the character row, not the full wiki
 * ingestion. Run ingestion separately once you have Sarah's source corpus.
 *
 * Usage:
 *   npx tsx scripts/seed-sarah.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getCharacterStore } from "@odyssey/db";

const SLUG = "sarah";

const INGESTION_PROMPT = `You are compiling source material into Sarah's knowledge graph.

Sarah (originally Sarai) is the wife of Abraham, appearing in Genesis 11–25. Treat Genesis as primary canon. When commentary (Rashi, Ibn Ezra, midrash, hadith) extends Genesis, cite it as commentary — don't promote it to canon.

Sarah's life spans three eras:
- "pre-covenant" — Ur and Haran, marriage to Abram, departure for Canaan. Her barrenness is established.
- "covenant" — the Egypt deception ("she is my sister"), the years of waiting, Hagar and the conception of Ishmael, the three visitors at Mamre, the laughter, Isaac's birth, the expulsion of Hagar.
- "post-binding" — Isaac as a young man, her death at Hebron at 127, her burial in the Cave of Machpelah.

Voice identity:
- Sarah is sharp, observant, and at times brittle. She has lived through barrenness, exile, and being passed off as her husband's sister twice.
- She laughs because she has earned the right to. The denial — "I did not laugh" — is fear, not deception.
- She is not deferential to Abraham. She gave him Hagar; she demanded Hagar be sent away. She makes things happen.
- Avoid modern idiom. Avoid pious softening. She is bitter, faithful, and tired in equal measure.
- Her metaphors are kitchen, tent-flap, womb, dust.`;

const ERAS = [
  { key: "pre-covenant", title: "Pre-Covenant", order: 0 },
  { key: "covenant", title: "Covenant Years", order: 1 },
  { key: "post-binding", title: "Post-Binding", order: 2 },
] as const;

async function main(): Promise<void> {
  const store = getCharacterStore();
  const existing = await store.getBySlug(SLUG);

  if (existing) {
    await store.update(existing.id, {
      title: "Sarah",
      summary:
        "Sarah, wife of Abraham. Mother of Isaac. Laughed at the promise — and denied it.",
      eras: ERAS as unknown as { key: string; title: string; order: number }[],
      ingestionPrompt: INGESTION_PROMPT,
    });
    console.log(`Updated existing character: ${existing.id} (slug=${SLUG})`);
    return;
  }

  const created = await store.create({
    slug: SLUG,
    title: "Sarah",
    summary:
      "Sarah, wife of Abraham. Mother of Isaac. Laughed at the promise — and denied it.",
    eras: ERAS as unknown as { key: string; title: string; order: number }[],
    ingestionPrompt: INGESTION_PROMPT,
  });
  console.log(`Created character: ${created.id} (slug=${SLUG})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
