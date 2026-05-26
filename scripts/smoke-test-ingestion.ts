/**
 * End-to-end smoke test for @odyssey/wiki-ingest.
 *
 * - Creates a throwaway character with a simple domain prompt.
 * - Attaches a small fictional source (~200 words) so the run is cheap.
 * - Runs the ingestion pipeline and logs every event.
 * - Asserts the run succeeded and pages landed in the DB.
 * - Cleans up the character (cascades wipe everything) unless --leave.
 *
 * Costs roughly $0.01–$0.05 per run on Sonnet. Requires ANTHROPIC_API_KEY.
 *
 * Usage:
 *   npx tsx scripts/smoke-test-ingestion.ts
 *   npx tsx scripts/smoke-test-ingestion.ts --leave       # keep data around
 *   npx tsx scripts/smoke-test-ingestion.ts --model haiku # swap the model
 */

// `override: true` beats empty shell exports of ANTHROPIC_API_KEY / DATABASE_URL.
import * as dotenv from "dotenv";
dotenv.config({ override: true });
import {
  getCharacterStore,
  getWikiStore,
  getWikisStore,
} from "@odyssey/db";
import { runIngestion, resolveModel } from "@odyssey/wiki-ingest";

const LEAVE = process.argv.includes("--leave");
const MODEL_FLAG_IDX = process.argv.indexOf("--model");
const MODEL_ARG =
  MODEL_FLAG_IDX >= 0 ? process.argv[MODEL_FLAG_IDX + 1] : undefined;
const SLUG = "smoke-test-ingestion";

// A small, self-contained fictional source. Agnostic to domain — proves
// the engine works for any character, not just Abraham.
const SOURCE_CONTENT = `
Margaret Hale was a private detective in Vienna in the 1920s. She ran her
practice from a two-room office on Kärntnerstraße with her assistant,
Felix Renner, a former medical student who kept the case notes.

Her most famous case was the disappearance of the Baron von Steiner in
1923. The baron vanished from his estate the night before his son's
wedding. Margaret found him three days later at a mountain sanatorium
where, it emerged, he had checked himself in under a false name because
he could not bear to attend. The case established her reputation.

She disliked publicity and refused most newspaper interviews. Her method
was patient and conversational — she preferred to let suspects talk
themselves into errors rather than confront them. Felix described her
once as "a woman who wins by listening longer than anyone else will."

In 1927 she solved the theft of the Gerstl landscape from the Belvedere,
which had been taken during a public reception. The painting was
recovered from a collector in Budapest. She retired in 1934.
`.trim();

async function main() {
  const model = resolveModel(
    MODEL_ARG ? `claude-${MODEL_ARG}-4-5` : undefined,
  );
  console.log(`\nSmoke test · model=${model} · leave=${LEAVE}\n`);

  const characters = getCharacterStore();
  const wiki = getWikiStore();
  const wikis = getWikisStore();

  // Clean slate
  const prior = await characters.getBySlug(SLUG);
  if (prior) {
    console.log(`Cleaning prior test character ${prior.id} …`);
    await characters.remove(prior.id);
  }

  // ── Create character ────────────────────────────────────────
  console.log("1. Creating character");
  const char = await characters.create({
    slug: SLUG,
    title: "Margaret Hale (smoke test)",
    summary: "Fictional 1920s Vienna detective for ingestion smoke tests.",
    ingestionPrompt: `You are compiling source material into Margaret Hale's knowledge graph.

Margaret Hale is a fictional private detective operating in Vienna during the interwar period (1918-1938). Treat biographical prose as primary. She speaks plainly and dryly. Central themes: patient observation, listening, European interwar social decay. Always link co-characters (Felix Renner, clients) as entity pages and famous cases as event pages.`,
    eras: [
      { key: "early", title: "Early Practice", order: 0 },
      { key: "peak", title: "Peak Years", order: 1 },
      { key: "retirement", title: "Retirement", order: 2 },
    ],
  });
  console.log(`   character id ${char.id}\n`);

  const targetWiki = await wikis.createWiki({
    slug: SLUG,
    title: "Margaret Hale Smoke Test",
    summary: "Throwaway wiki for ingestion smoke tests.",
    ingestionPrompt: char.ingestionPrompt,
    ingestionPromptName: "Smoke test lens",
    eras: char.eras,
  });
  await wikis.createBinding({
    characterId: char.id,
    wikiId: targetWiki.id,
    priority: "primary",
    isActive: true,
  });

  // ── Create source ───────────────────────────────────────────
  console.log("2. Creating source");
  const source = await wiki.createSource({
    wikiId: targetWiki.id,
    title: "Margaret Hale — biographical sketch",
    kind: "primary",
    content: SOURCE_CONTENT,
    metadata: { tags: ["biography", "fiction", "smoke-test"] },
  });
  console.log(`   source id ${source.id} · ${SOURCE_CONTENT.length} chars\n`);

  // ── Run ingestion ───────────────────────────────────────────
  console.log("3. Running ingestion\n");
  let runId = "";
  let finalResult: { pagesCreated: number; pagesUpdated: number; edgesAdded: number; tokensUsed: number } | null = null;
  let failed: string | null = null;

  for await (const ev of runIngestion({
    wikiId: targetWiki.id,
    sourceId: source.id,
    model,
  })) {
    switch (ev.type) {
      case "started":
        runId = ev.runId;
        console.log(`   ▸ started · runId=${ev.runId.slice(0, 8)}… · model=${ev.model}`);
        break;
      case "loaded-index":
        console.log(`   ▸ loaded-index · ${ev.pageCount} pages, ${ev.edgeCount} edges`);
        break;
      case "planning":
        console.log(`   ▸ planning …`);
        break;
      case "plan-complete":
        console.log(`   ▸ plan-complete · ${ev.opCount} ops, ${ev.contradictionCount} contradictions, ${ev.tokens} tok`);
        break;
      case "op-start":
        console.log(`   ▸ op-start [${ev.index + 1}/${ev.total}] ${ev.op.action} ${ev.op.slug} (${ev.op.type})`);
        break;
      case "op-complete":
        console.log(`     ✓ wrote "${ev.page.title}" · +${ev.edgesAdded}/-${ev.edgesRemoved} edges · ${ev.tokens} tok`);
        break;
      case "op-failed":
        console.log(`     ✗ ${ev.op.slug} — ${ev.error}`);
        break;
      case "edges-reconciled":
        console.log(`   ▸ edges-reconciled · +${ev.added}/-${ev.removed}`);
        break;
      case "succeeded":
        finalResult = ev.result;
        console.log(`\n   ✓ succeeded · ${ev.result.pagesCreated} created, ${ev.result.pagesUpdated} updated, ${ev.result.tokensUsed} tok total`);
        break;
      case "failed":
        failed = ev.error;
        console.log(`\n   ✗ FAILED — ${ev.error}`);
        break;
    }
  }

  if (failed) {
    console.error("\nSmoke test FAILED");
    process.exit(1);
  }
  if (!finalResult) {
    console.error("\nPipeline finished without succeeded event");
    process.exit(1);
  }

  // ── Verify DB state ─────────────────────────────────────────
  console.log("\n4. Verifying DB state");
  const pages = await wiki.listPagesForWiki(targetWiki.id);
  const edges = await wiki.listWikiEdges(targetWiki.id);
  console.log(`   pages=${pages.length} · edges=${edges.length}`);
  for (const p of pages) {
    const linkCount = edges.filter((e) => e.fromPageId === p.id || e.toPageId === p.id).length;
    console.log(`   · ${p.slug.padEnd(22)} [${p.type.padEnd(16)}] conf=${p.confidence.toFixed(2)} links=${linkCount}`);
  }

  if (pages.length === 0) {
    console.error("\nNo pages created — smoke test FAILED");
    process.exit(1);
  }

  const ingestRuns = await wiki.listIngestionRunsForWiki(targetWiki.id);
  console.log(`\n   ingestion runs=${ingestRuns.length} · status=${ingestRuns[0]?.status} · tokens=${ingestRuns[0]?.tokensUsed} · model=${ingestRuns[0]?.model}`);

  // ── Cleanup ─────────────────────────────────────────────────
  if (LEAVE) {
    console.log(`\n   Left character ${char.id} in place (--leave).\n`);
  } else {
    console.log("\n5. Cleanup");
    await wikis.deleteWiki(targetWiki.id);
    await characters.remove(char.id);
    console.log(`   removed wiki and character\n`);
  }

  console.log("✓ Smoke test passed.\n");
  void runId;
}

main().catch((err) => {
  console.error("\n✗ Smoke test crashed:", err);
  process.exit(1);
});
