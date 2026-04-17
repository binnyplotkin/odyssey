/**
 * Exercise @odyssey/wiki-curator against the Abraham wiki.
 *
 * Usage:
 *   npx tsx scripts/smoke-test-curator.ts
 *   npx tsx scripts/smoke-test-curator.ts --show-chunk       # print promptChunk
 *   npx tsx scripts/smoke-test-curator.ts --query "..."      # custom query
 *   npx tsx scripts/smoke-test-curator.ts --moment covenant:2  # time-gate
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getCharacterStore } from "@odyssey/db";
import { curate } from "@odyssey/wiki-curator";

const ABRAHAM_SLUG = "abraham";
const SHOW_CHUNK = process.argv.includes("--show-chunk");
const QUERY_IDX = process.argv.indexOf("--query");
const MOMENT_IDX = process.argv.indexOf("--moment");

/** Three canned scenarios — covers solo query, scene state, and time-gating. */
type Scenario = {
  name: string;
  query?: string;
  scene?: { activeEntities?: string[]; location?: string };
  currentMoment?: { era: string; index: number };
};

const SCENARIOS: Scenario[] = [
  {
    name: "Sarai asks about leaving home",
    query: "Are you afraid of leaving Haran? What did God tell you?",
    scene: { activeEntities: ["sarai"], location: "haran-city" },
  },
  {
    name: "Stranger asks about Lot",
    query: "Tell me about your nephew Lot.",
    scene: { activeEntities: ["lot"] },
  },
  {
    name: "Pharaoh's court — general presence",
    query: "Who is this woman with you?",
    scene: { activeEntities: ["sarai", "pharaoh"], location: "egypt" },
  },
  {
    name: "Pre-Egypt: should NOT know descent yet",
    query: "Have you been to Egypt?",
    scene: { activeEntities: ["sarai"] },
    // Character's moment is early covenant — before the descent event.
    currentMoment: { era: "covenant", index: 2 },
  },
  {
    name: "Baseline — no query, just who he is",
    query: undefined,
    scene: undefined,
  },
];

async function main() {
  const characters = getCharacterStore();
  const abraham = await characters.getBySlug(ABRAHAM_SLUG);
  if (!abraham) {
    console.error(`Abraham not found. Run: npx tsx scripts/seed-abraham.ts --ingest`);
    process.exit(1);
  }
  console.log(`Character: ${abraham.title} (${abraham.id.slice(0, 8)}…)`);
  console.log(`Eras: ${abraham.eras.map((e) => `${e.key}[${e.order}]`).join(" → ")}\n`);

  // Custom single run via CLI
  if (QUERY_IDX >= 0) {
    const query = process.argv[QUERY_IDX + 1];
    const scenario: Scenario = {
      name: "custom",
      query,
      currentMoment: parseMomentArg(MOMENT_IDX >= 0 ? process.argv[MOMENT_IDX + 1] : undefined),
    };
    await runScenario(abraham.id, scenario, SHOW_CHUNK);
    return;
  }

  for (const s of SCENARIOS) {
    await runScenario(abraham.id, s, SHOW_CHUNK);
    console.log();
  }
}

async function runScenario(
  characterId: string,
  s: Scenario,
  showChunk: boolean,
): Promise<void> {
  console.log(`▸ ${s.name}`);
  if (s.query) console.log(`  query:   "${s.query}"`);
  if (s.scene?.activeEntities?.length)
    console.log(`  scene:   active=${s.scene.activeEntities.join(", ")}`);
  if (s.scene?.location) console.log(`           location=${s.scene.location}`);
  if (s.currentMoment)
    console.log(`  moment:  ${s.currentMoment.era}·${s.currentMoment.index}`);

  const result = await curate({
    characterId,
    query: s.query,
    scene: s.scene,
    currentMoment: s.currentMoment,
    tokenBudget: 3000,
  });

  console.log(`  elapsed: ${result.elapsedMs}ms · tokens: ${result.tokensUsed}/${result.tokensBudget}`);
  console.log(`  seeds:   ${result.trace.seeds.length} · edges traversed: ${result.trace.edges.length}`);
  if (result.trace.timelineFiltered.length) {
    console.log(`  time-gated (not-yet-lived): ${result.trace.timelineFiltered.slice(0, 6).join(", ")}${result.trace.timelineFiltered.length > 6 ? "…" : ""}`);
  }
  if (result.trace.budgetDropped.length) {
    console.log(`  budget-dropped: ${result.trace.budgetDropped.slice(0, 6).join(", ")}${result.trace.budgetDropped.length > 6 ? "…" : ""}`);
  }

  console.log(`  selected pages (${result.pages.length}):`);
  const rows = result.pages.slice(0, 15).map((p) => {
    const score = String(Math.round(p.score)).padStart(5);
    const rendering = p.rendering.padEnd(7);
    const type = p.page.type.padEnd(14);
    return `    ${score}  ${rendering}  ${type}  ${p.page.slug.padEnd(32)}  [${p.origin}]`;
  });
  for (const row of rows) console.log(row);
  if (result.pages.length > rows.length) {
    console.log(`    … +${result.pages.length - rows.length} more`);
  }

  if (showChunk) {
    console.log(`\n  ── prompt chunk (${result.tokensUsed} tokens) ──`);
    console.log(indent(result.promptChunk, "    "));
    console.log(`  ── end chunk ──\n`);
  }
}

function parseMomentArg(v: string | undefined): { era: string; index: number } | undefined {
  if (!v) return undefined;
  const [era, idxStr] = v.split(":");
  const idx = Number(idxStr ?? "0");
  if (!era || Number.isNaN(idx)) return undefined;
  return { era, index: idx };
}

function indent(s: string, prefix: string): string {
  return s.split("\n").map((l) => prefix + l).join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
