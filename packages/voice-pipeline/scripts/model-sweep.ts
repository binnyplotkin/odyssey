/**
 * Brain-model A/B sweep — which LLM holds the character best?
 *
 * Runs each candidate brain model through the SAME eval set on both axes
 * (faithfulness + in-character quality: voice/persona/scope) plus first-token
 * latency, holding retrieval/curator/prompt constant so ONLY the brain changes.
 * Prints a side-by-side comparison so you can weigh character adherence against
 * the speed/cost tradeoff.
 *
 *   EMBEDDING_PROVIDER=openai npx tsx --env-file=.env \
 *     packages/voice-pipeline/scripts/model-sweep.ts <characterSlug>
 *
 * SWEEP_QUERIES=N (default 6) — queries per model. SWEEP_MODELS=id,id — override
 * the candidate list. EVAL_CONCURRENCY (default 3). JUDGE_MODEL overrides the judge.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getCharacterStore } from "@odyssey/db";
import { mapPool, replayAndEval, type EvalResult } from "./lib/grounding";

const CHARACTER = process.argv[2] ?? "abraham";
const N = Number(process.env.SWEEP_QUERIES ?? "6");
const CONC = Number(process.env.EVAL_CONCURRENCY ?? "3");

const DEFAULT_MODELS: Array<{ id: string; label: string }> = [
  { id: "gpt-oss-120b", label: "GPT-OSS 120B · Cerebras (current)" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B · Groq" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B · Groq" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B · Groq" },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout · Groq" },
  { id: "qwen/qwen3-32b", label: "Qwen 3 32B · Groq" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B · Groq" },
];
const MODELS = process.env.SWEEP_MODELS
  ? process.env.SWEEP_MODELS.split(",").map((id) => ({ id: id.trim(), label: id.trim() }))
  : DEFAULT_MODELS;

function loadQueries(slug: string): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, "eval-sets", `${slug}.json`), "utf8"));
  const all: string[] = Array.isArray(raw) ? raw : (raw.queries ?? []);
  return all.slice(0, N);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};
const f2 = (n: number) => (Number.isNaN(n) ? " — " : n.toFixed(2));

type Row = { model: string; r?: EvalResult; err?: string };

async function main() {
  const character =
    (await getCharacterStore().getBySlug(CHARACTER)) ??
    (await getCharacterStore().getById(CHARACTER));
  if (!character) {
    console.error(`character "${CHARACTER}" not found`);
    process.exit(1);
  }
  const queries = loadQueries(character.slug);

  console.log(`═══ BRAIN-MODEL SWEEP — ${character.title} ═══════════════════════════`);
  console.log(`queries: ${queries.length}  ·  models: ${MODELS.length}  ·  concurrency: ${CONC}`);
  console.log("(same retrieval + prompt for every model — only the brain swaps)\n");

  const pairs = MODELS.flatMap((m) => queries.map((q) => ({ m, q })));
  let done = 0;
  const results = await mapPool(pairs, CONC, async ({ m, q }): Promise<Row> => {
    try {
      const r = await replayAndEval({
        characterId: character.id,
        message: q,
        model: m.id,
        axes: { grounding: true, quality: true },
      });
      done += 1;
      if (done % 4 === 0) console.log(`  …${done}/${pairs.length}`);
      return { model: m.id, r };
    } catch (e) {
      done += 1;
      return { model: m.id, err: e instanceof Error ? e.message : String(e) };
    }
  });

  console.log("\n── COMPARISON (mean across queries; sorted by quality) ──────────────");
  console.log("model                               faith  voice persona scope  QUAL  ttft   ok");
  const summary = MODELS.map((m) => {
    const rs = results.filter((x) => x.model === m.id && x.r).map((x) => x.r!) as EvalResult[];
    const errs = results.filter((x) => x.model === m.id && x.err);
    const col = (sel: (r: EvalResult) => number | undefined) =>
      mean(rs.map(sel).filter((n): n is number => typeof n === "number" && !Number.isNaN(n)));
    const qual = col((r) => r.quality?.qualityScore);
    return {
      m,
      ok: rs.length,
      err: errs[0]?.err,
      faith: col((r) => r.grounding?.faithfulnessScore),
      voice: col((r) => r.quality?.voice.score),
      persona: col((r) => r.quality?.persona.score),
      scope: col((r) => r.quality?.scope.score),
      qual,
      ttft: median(rs.map((r) => r.firstTokenMs ?? NaN).filter((n) => !Number.isNaN(n))),
    };
  }).sort((a, b) => (Number.isNaN(b.qual) ? -1 : b.qual) - (Number.isNaN(a.qual) ? -1 : a.qual));

  for (const s of summary) {
    if (!s.ok) {
      console.log(`${s.m.label.padEnd(35)} all failed — ${(s.err ?? "").slice(0, 36)}`);
      continue;
    }
    console.log(
      `${s.m.label.padEnd(35)}${f2(s.faith)}   ${f2(s.voice)}  ${f2(s.persona)}   ${f2(s.scope)}  ${f2(s.qual)}  ${String(Math.round(s.ttft)).padStart(5)}  ${s.ok}/${queries.length}`,
    );
  }

  console.log(
    "\nfaith=knowledge faithfulness · voice≈conversational tone · persona≈personality · scope=in-period",
  );
  console.log("ttft = first-token ms (incl. constant retrieval prefix) — relative brain speed.");

  const report = {
    character: character.slug,
    at: new Date().toISOString(),
    queriesPerModel: queries.length,
    models: summary.map((s) => ({
      id: s.m.id,
      label: s.m.label,
      ok: s.ok,
      faithfulness: s.faith,
      voice: s.voice,
      persona: s.persona,
      scope: s.scope,
      quality: s.qual,
      ttftMs: s.ttft,
      error: s.err ?? null,
    })),
  };
  const out = join(process.cwd(), `model-sweep-${character.slug}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
