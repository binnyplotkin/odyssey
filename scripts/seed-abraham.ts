/**
 * Seed the Abraham character — upserts the character with a real
 * ingestion prompt + three-era config, and (optionally) runs ingestion
 * against Genesis 11:27–12:20 (World English Bible, public domain).
 *
 * Usage:
 *   npx tsx scripts/seed-abraham.ts                         # config only
 *   npx tsx scripts/seed-abraham.ts --ingest                # + ingest on Sonnet
 *   npx tsx scripts/seed-abraham.ts --ingest --model haiku  # cheaper
 *   npx tsx scripts/seed-abraham.ts --ingest --model opus   # best quality
 *
 * Expected cost on Sonnet 4.5 for this corpus: ~$0.30–0.60.
 * Expected wall time: ~3–5 minutes.
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getCharacterStore, getWikiStore, getWikisStore } from "@odyssey/db";
import { runIngestion, resolveModel } from "@odyssey/wiki-ingest";

/* ── CLI flags ─────────────────────────────────────────────────── */

const DO_INGEST = process.argv.includes("--ingest");
const MODEL_FLAG_IDX = process.argv.indexOf("--model");
const MODEL_ARG =
  MODEL_FLAG_IDX >= 0 ? process.argv[MODEL_FLAG_IDX + 1] : undefined;

/* ── Character config ──────────────────────────────────────────── */

const SLUG = "abraham";

const INGESTION_PROMPT = `You are compiling source material into Abraham's knowledge graph.

Abraham is a semi-historical patriarch (c. 2000 BCE) whose story appears in Genesis 11–25 across Abrahamic traditions (Jewish, Christian, Islamic). Treat Genesis as primary — the canonical ground truth. When a source conflicts with Genesis, flag the contradiction rather than overwriting.

Treat Rashi, Ibn Ezra, and midrashic sources as commentary — cite them, note which tradition a claim comes from, but do not elevate them to canon. Treat archaeological or historical scholarship as reference (contextual, not authoritative).

Abraham's life spans three eras:
- "pre-covenant" — before God's call at age 75. Ur, Haran, Terah, the life Abram left behind.
- "covenant" — from the call through the binding of Isaac (roughly ages 75–137). This is the narrative spine: the journey to Canaan, Egypt, Lot, Melchizedek, the covenant of pieces, Hagar, Ishmael, circumcision, the three visitors, Sodom, Isaac's birth, the binding.
- "post-binding" — from the binding onward (~137–175). Sarah's death at Hebron, Isaac's marriage to Rebekah, Abraham's remarriage to Keturah, his own death.

Every event page gets a timeIndex {era, index}. Events Abraham was promised but had not yet lived through (covenant fulfillment, "father of many nations", blessing of all families of earth) get knowsFuture: true — he knows of them, but from promise, not memory.

Always link: Sarai/Sarah, Isaac, Hagar, Ishmael, Lot, Eliezer, Melchizedek, Terah, Nahor. Central concepts to surface: hospitality, faith, covenant, sacrifice, kinship, land, blessing, sojourning, barrenness.

Voice identity:
- Abraham speaks plainly. He is old, not clever. Short sentences.
- He is intimate with God ("Here am I") but not theologically articulate.
- He does not quote scripture at himself — he lives it.
- Avoid modern idiom. Avoid prophecy-as-certainty. He leaves room for doubt.
- He is a shepherd-patriarch, not a scholar. His metaphors are tent, flock, land, stars.`;

const ERAS = [
  { key: "pre-covenant",  title: "Pre-Covenant",  order: 0 },
  { key: "covenant",      title: "Covenant Years", order: 1 },
  { key: "post-binding",  title: "Post-Binding",   order: 2 },
] as const;

/* ── Source content (WEB translation, public domain) ──────────── */

const SOURCE_TITLE = "Genesis 11:27 — 12:20 · Abram leaves Haran";
const SOURCE_CONTENT = `
# Genesis 11:27–32 · Terah's line and the migration from Ur

Now this is the history of the generations of Terah. Terah became the father of Abram, Nahor, and Haran. Haran became the father of Lot. Haran died in the land of his birth, in Ur of the Chaldees, while his father Terah was still alive.

Abram and Nahor took wives. The name of Abram's wife was Sarai, and the name of Nahor's wife was Milcah, the daughter of Haran, who was also the father of Iscah. Sarai was barren. She had no child.

Terah took Abram his son, Lot the son of Haran, his son's son, and Sarai his daughter-in-law, his son Abram's wife. They went from Ur of the Chaldees, to go into the land of Canaan. They came to Haran and lived there. The days of Terah were two hundred five years. Terah died in Haran.

# Genesis 12:1–9 · The call and the journey to Canaan

Now Yahweh said to Abram, "Leave your country, and your relatives, and your father's house, and go to the land that I will show you. I will make of you a great nation. I will bless you and make your name great. You will be a blessing. I will bless those who bless you, and I will curse him who curses you. All the families of the earth will be blessed in you."

So Abram went, as Yahweh had told him. Lot went with him. Abram was seventy-five years old when he departed from Haran. Abram took Sarai his wife, Lot his brother's son, all their possessions that they had gathered, and the people whom they had acquired in Haran, and they went to go into the land of Canaan. They entered into the land of Canaan.

Abram passed through the land to the place of Shechem, to the oak of Moreh. At that time, Canaanites were in the land. Yahweh appeared to Abram and said, "I will give this land to your offspring."

He built an altar there to Yahweh, who had appeared to him. He left from there to go to the mountain on the east of Bethel and pitched his tent, having Bethel on the west, and Ai on the east. There he built an altar to Yahweh and called on Yahweh's name. Abram traveled, still going on toward the South.

# Genesis 12:10–20 · The descent into Egypt

There was a famine in the land. Abram went down into Egypt to live as a foreigner there, for the famine was severe in the land. When he had come near to enter Egypt, he said to Sarai his wife, "See now, I know that you are a beautiful woman to look at. When the Egyptians see you, they will say, 'This is his wife.' They will kill me, but they will save you alive. Please say that you are my sister, that it may be well with me for your sake, and that my soul may live because of you."

When Abram had come into Egypt, the Egyptians saw that the woman was very beautiful. The princes of Pharaoh saw her, and praised her to Pharaoh; and the woman was taken into Pharaoh's house. He dealt well with Abram for her sake. He had sheep, cattle, male donkeys, male servants, female servants, female donkeys, and camels.

Yahweh afflicted Pharaoh and his house with great plagues because of Sarai, Abram's wife. Pharaoh called Abram and said, "What is this that you have done to me? Why didn't you tell me that she was your wife? Why did you say, 'She is my sister,' so that I took her to be my wife? Now therefore, see your wife, take her, and go your way."

Pharaoh commanded men concerning him, and they brought him on the way with his wife and all that he had.
`.trim();

const SOURCE_METADATA = {
  tags: ["bible", "genesis", "torah", "abrahamic", "web-translation"],
  translation: "World English Bible (WEB)",
  passage: "Gen 11:27 – 12:20",
  copyright: "public domain",
};

/* ── Main ──────────────────────────────────────────────────────── */

async function main() {
  const model = resolveModel(
    MODEL_ARG ? `claude-${MODEL_ARG}-4-5` : undefined,
  );
  console.log(`\nSeed Abraham · ingest=${DO_INGEST} · model=${model}\n`);

  const characters = getCharacterStore();
  const wiki = getWikiStore();
  const wikis = getWikisStore();

  // ── Upsert character ────────────────────────────────────────
  let character = await characters.getBySlug(SLUG);
  if (character) {
    console.log(`Character exists (id ${character.id}) — updating config`);
    const updated = await characters.update(character.id, {
      title: "Abraham",
      summary: "The first patriarch — simulated from Genesis 11–25 and interpretive traditions.",
      ingestionPrompt: INGESTION_PROMPT,
      eras: [...ERAS],
    });
    if (updated) character = updated;
  } else {
    console.log("Creating Abraham character …");
    character = await characters.create({
      slug: SLUG,
      title: "Abraham",
      summary: "The first patriarch — simulated from Genesis 11–25 and interpretive traditions.",
      ingestionPrompt: INGESTION_PROMPT,
      eras: [...ERAS],
    });
    console.log(`  created (id ${character.id})`);
  }

  console.log(`  eras: ${ERAS.map((e) => e.key).join(" → ")}`);
  console.log(`  ingestion prompt: ${INGESTION_PROMPT.length} chars, ~${Math.ceil(INGESTION_PROMPT.length / 4)} tokens\n`);

  const boundWikis = await wikis.listWikisForCharacter(character.id);
  let targetWiki = boundWikis.find((w) => w.binding.priority === "primary") ?? boundWikis[0];
  if (!targetWiki) {
    const createdWiki = await wikis.createWiki({
      slug: "abraham",
      title: "Abraham",
      summary: "Shared Abraham knowledge graph.",
      eras: [...ERAS],
      ingestionPrompt: INGESTION_PROMPT,
      ingestionPromptName: "Abraham lens",
    });
    const binding = await wikis.createBinding({
      characterId: character.id,
      wikiId: createdWiki.id,
      priority: "primary",
      isActive: true,
    });
    targetWiki = { ...createdWiki, binding };
  }

  if (!DO_INGEST) {
    console.log("Done (config only).");
    console.log("Open http://localhost:3001/characters/abraham to review.");
    console.log("Re-run with --ingest to compile the first source into the wiki.\n");
    return;
  }

  // ── Create source row ───────────────────────────────────────
  console.log(`Creating source: "${SOURCE_TITLE}"`);
  console.log(`  ${SOURCE_CONTENT.length} chars, ~${Math.ceil(SOURCE_CONTENT.length / 4)} tokens`);
  const source = await wiki.createSource({
    wikiId: targetWiki.id,
    title: SOURCE_TITLE,
    kind: "primary",
    content: SOURCE_CONTENT,
    metadata: SOURCE_METADATA,
  });
  console.log(`  source id ${source.id}\n`);

  // ── Run ingestion ───────────────────────────────────────────
  console.log(`Ingesting with ${model} — this will call the LLM ~12–20 times.\n`);

  let finalTokens = 0;
  let failed: string | null = null;
  const runStart = Date.now();

  for await (const ev of runIngestion({
    wikiId: targetWiki.id,
    sourceId: source.id,
    model,
  })) {
    switch (ev.type) {
      case "started":
        console.log(`  ▸ started · runId=${ev.runId.slice(0, 8)}… · model=${ev.model}`);
        break;
      case "loaded-index":
        console.log(`  ▸ loaded-index · ${ev.pageCount} existing pages, ${ev.edgeCount} edges`);
        break;
      case "planning":
        console.log(`  ▸ planning…`);
        break;
      case "plan-complete":
        console.log(`  ▸ plan-complete · ${ev.opCount} ops · ${ev.contradictionCount} contradictions · ${ev.tokens.toLocaleString()} tok`);
        break;
      case "op-start":
        console.log(`  ▸ [${String(ev.index + 1).padStart(2)}/${ev.total}] ${ev.op.action} ${ev.op.slug} (${ev.op.type})`);
        break;
      case "op-complete":
        console.log(`      ✓ "${ev.page.title}" · +${ev.edgesAdded}/-${ev.edgesRemoved} edges · ${ev.tokens.toLocaleString()} tok`);
        break;
      case "op-failed":
        console.log(`      ✗ ${ev.op.slug} — ${ev.error}`);
        break;
      case "edges-reconciled":
        console.log(`  ▸ edges reconciled · +${ev.added}/-${ev.removed}`);
        break;
      case "succeeded":
        finalTokens = ev.result.tokensUsed;
        console.log(`\n  ✓ succeeded · ${ev.result.pagesCreated} created, ${ev.result.pagesUpdated} updated · ${ev.result.tokensUsed.toLocaleString()} tok total`);
        break;
      case "failed":
        failed = ev.error;
        console.log(`\n  ✗ FAILED — ${ev.error}`);
        break;
    }
  }

  const wallSecs = Math.round((Date.now() - runStart) / 1000);
  console.log(`\nWall time: ${Math.floor(wallSecs / 60)}m ${String(wallSecs % 60).padStart(2, "0")}s`);

  if (failed) {
    console.error("\nIngestion failed.");
    process.exit(1);
  }

  // ── Summarize result ────────────────────────────────────────
  const pages = await wiki.listPages(character.id);
  const edges = await wiki.listCharacterEdges(character.id);

  console.log(`\nFinal state:`);
  console.log(`  pages=${pages.length} · edges=${edges.length} · tokens=${finalTokens.toLocaleString()}`);

  const byType = pages.reduce<Record<string, number>>((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + 1;
    return acc;
  }, {});
  for (const [type, count] of Object.entries(byType)) {
    console.log(`    ${type.padEnd(18)} ${count}`);
  }

  console.log(`\n✓ Done. Open:`);
  console.log(`    http://localhost:3001/characters/abraham/wiki`);
  console.log(`  to browse the graph.\n`);
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});
