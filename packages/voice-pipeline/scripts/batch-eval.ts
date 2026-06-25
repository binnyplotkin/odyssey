/**
 * Batch grounding eval — run a SET of queries through a character and score how
 * grounded each response is. Produces a scorecard (mean/median grounding,
 * verdict distribution, knowledge usage) + ranked failures, and writes a JSON
 * report for regression comparison.
 *
 *   EMBEDDING_PROVIDER=openai npx tsx --env-file=.env \
 *     packages/voice-pipeline/scripts/batch-eval.ts <characterSlug> [queriesFile]
 *
 * queriesFile: a JSON array of strings (or {query} objects), or a newline-separated
 * list (# comments allowed). Defaults to scripts/eval-sets/<slug>.json if present,
 * else a small built-in probe set. EVAL_CONCURRENCY (default 3) tunes fan-out.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getCharacterStore } from "@odyssey/db";
import { DEFAULT_JUDGE_MODEL, mapPool, replayAndGrade, type GradedTurn } from "./lib/grounding";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHARACTER = process.argv[2] ?? "abraham";
const QUERIES_ARG = process.argv[3];
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? "3");

const BUILTIN_QUERIES = [
  "Tell me about the hardest thing you were ever asked to do.",
  "Who is your family?",
  "Where do you live, and what is your daily life like?",
  "What do you believe in most deeply?",
];

function loadQueries(slug: string): { source: string; queries: string[] } {
  const path =
    QUERIES_ARG ??
    (existsSync(resolve(HERE, `eval-sets/${slug}.json`)) ? resolve(HERE, `eval-sets/${slug}.json`) : null);
  if (!path) return { source: "built-in", queries: BUILTIN_QUERIES };
  const raw = readFileSync(path, "utf8").trim();
  const queries = raw.startsWith("[")
    ? (JSON.parse(raw) as Array<string | { query?: string }>)
        .map((x) => (typeof x === "string" ? x : x.query ?? ""))
        .filter(Boolean)
    : raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
  return { source: path, queries };
}

function pct(n: number, d: number): string {
  return d ? `${Math.round((100 * n) / d)}%` : "—";
}

async function main() {
  const character =
    (await getCharacterStore().getById(CHARACTER)) ??
    (await getCharacterStore().getBySlug(CHARACTER));
  if (!character) {
    console.error(`character "${CHARACTER}" not found`);
    process.exit(1);
  }
  const { source, queries } = loadQueries(character.slug);
  const embedder = process.env.EMBEDDING_PROVIDER ?? "bge";

  console.log("═══ BATCH GROUNDING EVAL ══════════════════════════════════════════");
  console.log(`character : ${character.title} (${character.slug})`);
  console.log(`queries   : ${queries.length}  (source: ${source})`);
  console.log(`judge     : ${DEFAULT_JUDGE_MODEL}   embedder: ${embedder}   concurrency: ${CONCURRENCY}`);
  console.log("");

  let done = 0;
  const results = await mapPool(queries, CONCURRENCY, async (q) => {
    try {
      const g = await replayAndGrade({ characterId: character.id, message: q });
      done += 1;
      const s = g.verdict.faithfulnessScore.toFixed(2);
      console.log(`  [${done}/${queries.length}] ${s} ${g.verdict.verdict.padEnd(16)} "${q.slice(0, 50)}${q.length > 50 ? "…" : ""}"`);
      return g;
    } catch (err) {
      done += 1;
      console.log(`  [${done}/${queries.length}] ERR  "${q.slice(0, 56)}": ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  const ok = results.filter(Boolean) as GradedTurn[];
  if (!ok.length) {
    console.error("\nno turns graded successfully.");
    process.exit(1);
  }

  const scores = ok.map((g) => g.verdict.faithfulnessScore).sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const median = scores[Math.floor(scores.length / 2)] ?? 0;
  const dist: Record<string, number> = {};
  for (const g of ok) dist[g.verdict.verdict] = (dist[g.verdict.verdict] ?? 0) + 1;
  const usedKnowledge = ok.filter((g) => g.verdict.usedRetrievedKnowledge).length;
  const noRetrieval = ok.filter((g) => g.pageSlugs.length === 0).length;
  const turnsWithFab = ok.filter((g) => g.verdict.fabrications.length > 0).length;
  const totalFab = ok.reduce((a, g) => a + g.verdict.fabrications.length, 0);
  const totalEmb = ok.reduce((a, g) => a + g.verdict.embellishments.length, 0);
  const judgeTokens = ok.reduce((a, g) => a + g.judge.inputTokens + g.judge.outputTokens, 0);

  console.log("\n── SCORECARD ───────────────────────────────────────────────────────");
  console.log(`graded        : ${ok.length}/${queries.length}`);
  console.log(`faithfulness  : mean ${mean.toFixed(2)}  ·  median ${median.toFixed(2)}  ·  min ${scores[0]!.toFixed(2)}`);
  console.log(`verdicts      : ${Object.entries(dist).map(([k, v]) => `${k} ${v}`).join("  ·  ")}`);
  console.log(`fabrications  : ${totalFab} across ${turnsWithFab}/${ok.length} turns   ← real grounding failures`);
  console.log(`embellishment : ${totalEmb} (sensory color — not scored)`);
  console.log(`used graph    : ${usedKnowledge}/${ok.length} (${pct(usedKnowledge, ok.length)})`);
  console.log(`no retrieval  : ${noRetrieval}/${ok.length} (${pct(noRetrieval, ok.length)})`);
  console.log(`judge tokens  : ${judgeTokens.toLocaleString()}`);

  const failures = [...ok]
    .filter((g) => g.verdict.fabrications.length > 0)
    .sort((a, b) => a.verdict.faithfulnessScore - b.verdict.faithfulnessScore);
  if (failures.length) {
    console.log("\n── FABRICATIONS (real grounding failures) ──────────────────────────");
    for (const g of failures) {
      console.log(`\n  ${g.verdict.faithfulnessScore.toFixed(2)} · "${g.message}"`);
      console.log(`    → ${g.response.replace(/\s+/g, " ").trim().slice(0, 140)}…`);
      for (const f of g.verdict.fabrications) console.log(`    ✗ ${f}`);
    }
  } else {
    console.log("\n✓ no fabrications — every graded turn is factually faithful (embellishment aside).");
  }

  const report = {
    character: character.slug,
    judge: DEFAULT_JUDGE_MODEL,
    embedder,
    at: new Date().toISOString(),
    queries: queries.length,
    graded: ok.length,
    faithfulnessMean: mean,
    faithfulnessMedian: median,
    faithfulnessMin: scores[0],
    distribution: dist,
    fabricationTurns: turnsWithFab,
    totalFabrications: totalFab,
    totalEmbellishments: totalEmb,
    usedKnowledge,
    noRetrieval,
    turns: ok.map((g) => ({
      message: g.message,
      faithfulness: g.verdict.faithfulnessScore,
      verdict: g.verdict.verdict,
      usedRetrievedKnowledge: g.verdict.usedRetrievedKnowledge,
      pages: g.pageSlugs,
      fabrications: g.verdict.fabrications,
      embellishments: g.verdict.embellishments,
      response: g.response,
    })),
  };
  const outPath = resolve(process.cwd(), `eval-report-${character.slug}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
