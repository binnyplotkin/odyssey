/**
 * Batch eval — run a SET of queries through a character and score each on TWO axes:
 * faithfulness (grounded in its knowledge?) and in-character quality (true to its
 * voice/persona/scope?). Produces a two-dimensional scorecard + ranked failures
 * (fabrications and lowest-quality turns) and a JSON report for regression.
 *
 *   EMBEDDING_PROVIDER=openai npx tsx --env-file=.env \
 *     packages/voice-pipeline/scripts/batch-eval.ts <characterSlug> [queriesFile]
 *
 * queriesFile: JSON array of strings (or {query} objects) or a newline list (# comments).
 * Defaults to scripts/eval-sets/<slug>.json if present, else a built-in probe set.
 * EVAL_AXES=grounding|quality|both (default both). EVAL_CONCURRENCY (default 3).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getCharacterStore } from "@odyssey/db";
import { DEFAULT_JUDGE_MODEL, mapPool, replayAndEval, type EvalResult } from "./lib/grounding";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHARACTER = process.argv[2] ?? "abraham";
const QUERIES_ARG = process.argv[3];
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? "3");
const AXES_ENV = (process.env.EVAL_AXES ?? "both").toLowerCase();
const AXES = {
  grounding: AXES_ENV === "both" || AXES_ENV === "grounding",
  quality: AXES_ENV === "both" || AXES_ENV === "quality",
};

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
    : raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return { source: path, queries };
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return {
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0,
    median: s[Math.floor(s.length / 2)] ?? 0,
    min: s[0] ?? 0,
  };
};
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");

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
  const axisLabel = [AXES.grounding && "faithfulness", AXES.quality && "quality"].filter(Boolean).join(" + ");

  console.log("═══ BATCH EVAL ════════════════════════════════════════════════════");
  console.log(`character : ${character.title} (${character.slug})`);
  console.log(`queries   : ${queries.length}  (source: ${source})`);
  console.log(`judge     : ${DEFAULT_JUDGE_MODEL}   embedder: ${embedder}   axes: ${axisLabel}   concurrency: ${CONCURRENCY}`);
  console.log("");

  let done = 0;
  const results = await mapPool(queries, CONCURRENCY, async (q) => {
    try {
      const r = await replayAndEval({ characterId: character.id, message: q, axes: AXES });
      done += 1;
      const f = r.grounding ? r.grounding.faithfulnessScore.toFixed(2) : "—";
      const ql = r.quality ? r.quality.qualityScore.toFixed(2) : "—";
      console.log(`  [${done}/${queries.length}] faith ${f}  qual ${ql}  "${q.slice(0, 46)}${q.length > 46 ? "…" : ""}"`);
      return r;
    } catch (err) {
      done += 1;
      console.log(`  [${done}/${queries.length}] ERR  "${q.slice(0, 46)}": ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });
  const ok = results.filter(Boolean) as EvalResult[];
  if (!ok.length) {
    console.error("\nno turns graded successfully.");
    process.exit(1);
  }

  const grounded = ok.map((r) => r.grounding).filter(Boolean) as NonNullable<EvalResult["grounding"]>[];
  const quals = ok.map((r) => r.quality).filter(Boolean) as NonNullable<EvalResult["quality"]>[];
  const judgeTokens = ok.reduce(
    (a, r) => a + (r.grounding ? r.grounding.judge.inputTokens + r.grounding.judge.outputTokens : 0) + (r.quality ? r.quality.judge.inputTokens + r.quality.judge.outputTokens : 0),
    0,
  );

  console.log("\n── SCORECARD ───────────────────────────────────────────────────────");
  console.log(`graded        : ${ok.length}/${queries.length}`);
  if (grounded.length) {
    const f = stats(grounded.map((g) => g.faithfulnessScore));
    const fabTurns = grounded.filter((g) => g.fabrications.length > 0).length;
    const totalFab = grounded.reduce((a, g) => a + g.fabrications.length, 0);
    const totalEmb = grounded.reduce((a, g) => a + g.embellishments.length, 0);
    const usedKnowledge = grounded.filter((g) => g.usedRetrievedKnowledge).length;
    console.log(`FAITHFULNESS  : mean ${f.mean.toFixed(2)} · median ${f.median.toFixed(2)} · min ${f.min.toFixed(2)}   (fabrications ${totalFab} across ${fabTurns} turns)`);
    console.log(`              : embellishments ${totalEmb} (sensory color, not scored) · used graph ${pct(usedKnowledge, grounded.length)}`);
  }
  if (quals.length) {
    const q = stats(quals.map((x) => x.qualityScore));
    const qDist: Record<string, number> = {};
    for (const x of quals) qDist[x.verdict] = (qDist[x.verdict] ?? 0) + 1;
    const voice = stats(quals.map((x) => x.voice.score)).mean;
    const persona = stats(quals.map((x) => x.persona.score)).mean;
    const scope = stats(quals.map((x) => x.scope.score)).mean;
    console.log(`QUALITY       : mean ${q.mean.toFixed(2)} · median ${q.median.toFixed(2)} · min ${q.min.toFixed(2)}`);
    console.log(`              : voice ${voice.toFixed(2)} · persona ${persona.toFixed(2)} · scope ${scope.toFixed(2)}`);
    console.log(`  verdicts    : ${Object.entries(qDist).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }
  console.log(`judge tokens  : ${judgeTokens.toLocaleString()}`);

  const fabFailures = ok
    .filter((r) => (r.grounding?.fabrications.length ?? 0) > 0)
    .sort((a, b) => (a.grounding!.faithfulnessScore) - (b.grounding!.faithfulnessScore));
  if (fabFailures.length) {
    console.log("\n── FABRICATIONS (ungrounded world-facts) ───────────────────────────");
    for (const r of fabFailures) {
      console.log(`\n  ${r.grounding!.faithfulnessScore.toFixed(2)} · "${r.message}"`);
      for (const f of r.grounding!.fabrications) console.log(`    ✗ ${f}`);
    }
  }

  const qualFailures = ok
    .filter((r) => r.quality && r.quality.qualityScore < 0.9)
    .sort((a, b) => a.quality!.qualityScore - b.quality!.qualityScore)
    .slice(0, 5);
  if (qualFailures.length) {
    console.log("\n── LOWEST IN-CHARACTER QUALITY ─────────────────────────────────────");
    for (const r of qualFailures) {
      const q = r.quality!;
      console.log(`\n  ${q.qualityScore.toFixed(2)} ${q.verdict} · "${r.message}"  (voice ${q.voice.score.toFixed(1)} persona ${q.persona.score.toFixed(1)} scope ${q.scope.score.toFixed(1)})`);
      for (const i of q.issues) console.log(`    ⚠ ${i}`);
    }
  }
  if (!fabFailures.length && !qualFailures.length) {
    console.log("\n✓ no fabrications and no quality drift — clean across the set.");
  }

  const report = {
    character: character.slug,
    judge: DEFAULT_JUDGE_MODEL,
    embedder,
    axes: AXES,
    at: new Date().toISOString(),
    queries: queries.length,
    graded: ok.length,
    faithfulness: grounded.length ? stats(grounded.map((g) => g.faithfulnessScore)) : null,
    quality: quals.length ? stats(quals.map((x) => x.qualityScore)) : null,
    turns: ok.map((r) => ({
      message: r.message,
      faithfulness: r.grounding?.faithfulnessScore ?? null,
      fabrications: r.grounding?.fabrications ?? [],
      embellishments: r.grounding?.embellishments ?? [],
      usedRetrievedKnowledge: r.grounding?.usedRetrievedKnowledge ?? null,
      quality: r.quality?.qualityScore ?? null,
      qualityVerdict: r.quality?.verdict ?? null,
      voice: r.quality?.voice.score ?? null,
      persona: r.quality?.persona.score ?? null,
      scope: r.quality?.scope.score ?? null,
      issues: r.quality?.issues ?? [],
      pages: r.pageSlugs,
      response: r.response,
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
