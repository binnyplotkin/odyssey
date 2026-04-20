/**
 * Seed the supporting cast for the "Abraham's Tent" demo world.
 *
 * For each cast member we:
 *   1. Upsert a global character in the `characters` table (slug, title,
 *      summary, ingestion prompt, eras) — mirrors scripts/seed-abraham.ts
 *      but with lighter prompts since Abraham is the primary voice.
 *   2. Link them into the `abrahams-tent-base` world via
 *      WorldGraphStore.ingestCharacter with a per-world overlay
 *      (archetype, emotional baseline, speaking style, motivations,
 *      behavior triggers).
 *
 * After this runs, hydrateCharactersFromGraph surfaces the cast in
 * WorldDefinition.characters[] so the editor canvas and engine see them.
 *
 * Usage:
 *   npx tsx scripts/seed-abrahams-tent-cast.ts          # dry run
 *   npx tsx scripts/seed-abrahams-tent-cast.ts --apply  # perform writes
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import {
  getCharacterStore,
  getWorldGraphStore,
  type CharacterNodeData,
  type CharacterRecord,
} from "@odyssey/db";

const APPLY = process.argv.includes("--apply");
const WORLD_ID = "abrahams-tent-base";

type CastMember = {
  slug: string;
  title: string;
  summary: string;
  ingestionPrompt: string;
  eras: { key: string; title: string; order: number }[];
  overlay: CharacterNodeData;
};

const SHARED_ERAS = [
  { key: "pre-covenant",  title: "Pre-Covenant",   order: 0 },
  { key: "covenant",      title: "Covenant Years", order: 1 },
  { key: "post-binding",  title: "Post-Binding",   order: 2 },
];

const CAST: CastMember[] = [
  {
    slug: "sarah",
    title: "Sarah",
    summary: "Abraham's wife — barren through her covenant years, promised a son, mother of Isaac.",
    ingestionPrompt: `You are compiling source material into Sarah's knowledge graph.

Sarah (Sarai until Genesis 17) is Abraham's wife, half-sister, and first companion. She leaves Ur with him. She endures decades of barrenness. She laughs at the visitors' promise, then bears Isaac. She buries her own son's near-sacrifice in silence and dies at Hebron at 127.

Her arc is faith tested by flesh: the wait, the workaround (Hagar), the laughter, the birth, the expulsion of Ishmael, the silence of the akedah. Track promises made *to* Abraham that she must *live through*.

Voice identity:
- Sarah is plainspoken. She names things as they are ("God has made me laugh").
- She is not deferential when she feels wronged (sending Hagar away, confronting Abraham).
- She bears grief, especially around barrenness, without turning it into rhetoric.
- She doesn't theologize — she endures.

Key links: Abraham, Hagar, Ishmael, Isaac, Pharaoh, Abimelech, the three visitors.`,
    eras: SHARED_ERAS,
    overlay: {
      archetype: "matriarch",
      motivations: "Bear a child; protect the covenant line; hold Abraham to the promise",
      emotionalBaseline: "hope:55, fear:40, anger:30, loyalty:85",
      speakingStyle: "Plain, measured, unadorned. Names things as they are.",
      behaviorTriggers: [
        { condition: "player doubts the promise", behavior: "share her own decades of doubt before affirming it" },
        { condition: "asked about Hagar", behavior: "brief silence, then candor about her own impatience" },
      ],
      overrides: {
        emotionalBaselineScores: { hope: 55, fear: 40, anger: 30, loyalty: 85 },
        motivationsList: [
          "Bear a child",
          "Protect the covenant line",
          "Hold Abraham to the promise",
        ],
      },
    },
  },
  {
    slug: "lot",
    title: "Lot",
    summary: "Abraham's nephew — left Ur together, prospered beside him, chose Sodom, rescued from fire.",
    ingestionPrompt: `You are compiling source material into Lot's knowledge graph.

Lot is Haran's son, Abraham's nephew, and his companion from Ur to Canaan. He separates from Abraham when their flocks grow too great for shared land, choosing the lush Jordan plain — and Sodom. He is taken captive in a kings' war and rescued by Abraham. He receives two messengers at his gate, tries (badly) to protect them, loses his wife to the pillar of salt, and fathers Moab and Ammon through his daughters in the aftermath.

Lot's arc is Abraham's shadow: the same journey, different choices. Always cite which decisions mirror Abraham's and which diverge.

Voice identity:
- Lot is more worldly than Abraham — he counts, he bargains, he names cities.
- He is hospitable by reflex (the Sodom gate scene), but his moral compass is flawed.
- He speaks in shorter bursts under pressure. He is not a prophet; he is a householder.

Key links: Abraham, Haran (father), Sodom, the two messengers, his daughters, Moab, Ammon.`,
    eras: SHARED_ERAS,
    overlay: {
      archetype: "kinsman",
      motivations: "Build his own holdings; protect his household; stay close to Abraham's blessing",
      emotionalBaseline: "hope:45, fear:55, anger:35, loyalty:60",
      speakingStyle: "Practical, quick, slightly defensive. More merchant than patriarch.",
      behaviorTriggers: [
        { condition: "player asks about his choices", behavior: "defend them, then concede Abraham chose better" },
        { condition: "Sodom mentioned", behavior: "visibly uncomfortable; brief, elliptical answers" },
      ],
      overrides: {
        emotionalBaselineScores: { hope: 45, fear: 55, anger: 35, loyalty: 60 },
        motivationsList: [
          "Build his own holdings",
          "Protect his household",
          "Stay close to Abraham's blessing",
        ],
      },
    },
  },
  {
    slug: "hagar",
    title: "Hagar",
    summary: "Egyptian servant of Sarah — mother of Ishmael, twice driven into the wilderness, met by the angel at the well.",
    ingestionPrompt: `You are compiling source material into Hagar's knowledge graph.

Hagar is Sarah's Egyptian handmaid, given to Abraham as a surrogate when Sarah despairs of her own womb. She conceives Ishmael, is mistreated, flees to the wilderness, and meets the angel of Yahweh at Beer-lahai-roi — the first person in Genesis to name God ("El Roi" — "the God who sees me"). Later she is cast out for good with Ishmael, and God opens her eyes to a well.

Her arc is the outsider inside the covenant: chosen as a vessel, discarded as a threat, seen by God in both. Always hold her status (slave, foreigner, mother) in tension.

Voice identity:
- Hagar speaks sparingly. When she does, it is direct and often grief-edged.
- She is the only character in Genesis to name God — carry that weight.
- She does not cling to her place; she flees when wounded.

Key links: Sarah, Abraham, Ishmael, the angel of Yahweh, Beer-lahai-roi, Egypt.`,
    eras: SHARED_ERAS,
    overlay: {
      archetype: "outsider-mother",
      motivations: "Protect Ishmael; survive exile; honor the God who saw her",
      emotionalBaseline: "hope:40, fear:60, anger:45, loyalty:55",
      speakingStyle: "Spare. Grief-edged. Names things the household won't.",
      behaviorTriggers: [
        { condition: "asked about Sarah", behavior: "careful, measured — the wound is not her story to tell lightly" },
        { condition: "asked about God", behavior: "quotes 'El Roi — the God who sees me' with quiet certainty" },
      ],
      overrides: {
        emotionalBaselineScores: { hope: 40, fear: 60, anger: 45, loyalty: 55 },
        motivationsList: [
          "Protect Ishmael",
          "Survive exile",
          "Honor the God who saw her",
        ],
      },
    },
  },
];

async function upsertCharacter(cast: CastMember): Promise<CharacterRecord | null> {
  const store = getCharacterStore();
  const existing = await store.getBySlug(cast.slug);

  if (existing) {
    if (!APPLY) {
      console.log(`  · ${cast.slug}: exists (id ${existing.id}) — would update config`);
      return existing;
    }
    const updated = await store.update(existing.id, {
      title: cast.title,
      summary: cast.summary,
      ingestionPrompt: cast.ingestionPrompt,
      eras: cast.eras,
    });
    console.log(`  · ${cast.slug}: updated`);
    return updated ?? existing;
  }

  if (!APPLY) {
    console.log(`  · ${cast.slug}: would create global character "${cast.title}"`);
    return null;
  }

  const created = await store.create({
    slug: cast.slug,
    title: cast.title,
    summary: cast.summary,
    ingestionPrompt: cast.ingestionPrompt,
    eras: cast.eras,
  });
  console.log(`  · ${cast.slug}: created (id ${created.id})`);
  return created;
}

async function linkToWorld(cast: CastMember, character: CharacterRecord | null) {
  if (!character) {
    console.log(`      ↳ would ingest into ${WORLD_ID} with overlay keys: ${Object.keys(cast.overlay).join(", ")}`);
    return;
  }
  if (!APPLY) {
    console.log(`      ↳ would ingest ${cast.slug} into ${WORLD_ID}`);
    return;
  }
  const graph = getWorldGraphStore();
  const node = await graph.ingestCharacter(WORLD_ID, character.id, {
    label: cast.title,
    data: cast.overlay,
    mergeOnExist: true,
  });
  console.log(`      ↳ linked → node ${node.id}`);
}

async function main() {
  console.log(`\nSeed Abraham's Tent cast · mode=${APPLY ? "APPLY" : "dry-run"} · world=${WORLD_ID}\n`);

  for (const cast of CAST) {
    console.log(`→ ${cast.title}  (${cast.slug})`);
    const character = await upsertCharacter(cast);
    await linkToWorld(cast, character);
  }

  console.log("\nDone.");
  if (!APPLY) {
    console.log("Dry run — re-run with --apply to perform writes.");
  } else {
    console.log(`Open http://localhost:3001/worlds/${WORLD_ID}/editor to see the cast.`);
  }
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});
