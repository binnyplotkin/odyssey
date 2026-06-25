/**
 * Prompt-construction A/B sweep — which way of ASSEMBLING the prompt holds the
 * character best? Sibling of model-sweep, but it varies the CONSTRUCTION (block
 * order, delivery wording, added steering, context framing) instead of the brain,
 * holding model + retrieval constant. Each variant is a ConstructionVariantFn that
 * rewrites the assembled envelope before the LLM (debug-only hook).
 *
 *   EMBEDDING_PROVIDER=openai npx tsx --env-file=.env \
 *     packages/voice-pipeline/scripts/construction-sweep.ts <characterSlug>
 *
 * SWEEP_QUERIES=N (default 8). EVAL_CONCURRENCY (default 3). JUDGE_MODEL overrides.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getCharacterStore } from "@odyssey/db";
import type { ConstructionVariantFn } from "@odyssey/voice-pipeline";
import { mapPool, replayAndEval, type EvalResult } from "./lib/grounding";

const CHARACTER = process.argv[2] ?? "abraham";
const N = Number(process.env.SWEEP_QUERIES ?? "8");
const CONC = Number(process.env.EVAL_CONCURRENCY ?? "3");

/** Grab one top-level XML block (`<tag>…</tag>`) from the assembled cached envelope. */
const block = (cached: string, tag: string): string =>
  cached.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`))?.[0] ?? "";

const FIRM_DELIVERY = `<delivery>
  This is a real-time voice conversation, not an interview or essay.
  - Brevity is the rule. Honor the brevity in your <voice> even for deep questions — say one true thing, then stop. They can ask for more.
  - Speak plainly and concretely; use contractions. Avoid ornate or lyrical phrasing.
  - No bullet lists, numbering, preambles, or restating the question.
</delivery>`;

const STEER = `<reminder>
  Above all: stay terse and plain-spoken — one or two sentences. Use contractions. No lyricism.
</reminder>`;

// Each variant rewrites the assembled envelope. baseline = identity (no change).
const VARIANTS: Array<{ name: string; fn: ConstructionVariantFn | null }> = [
  { name: "baseline", fn: null },
  {
    name: "voice-first", // structural: lead with HOW to speak, before WHO
    fn: ({ parts }) => {
      const id = block(parts.cached, "identity");
      const vo = block(parts.cached, "voice");
      if (!id || !vo) return parts;
      const cached = parts.cached
        .replace(id, "%%ID%%")
        .replace(vo, "%%VO%%")
        .replace("%%ID%%", vo)
        .replace("%%VO%%", id);
      return { ...parts, cached };
    },
  },
  {
    name: "firm-delivery", // structural: firmer delivery, no paragraph loophole
    fn: ({ parts }) => {
      const d = block(parts.cached, "delivery");
      return d ? { ...parts, cached: parts.cached.replace(d, FIRM_DELIVERY) } : parts;
    },
  },
  {
    name: "append-steer", // framing: extra terse-voice reminder at the envelope tail
    fn: ({ parts }) => ({ ...parts, cached: `${parts.cached}\n\n${STEER}` }),
  },
  {
    name: "context-brevity-tail", // context: brevity nudge right next to the knowledge
    fn: ({ parts }) =>
      parts.perTurn
        ? { ...parts, perTurn: `${parts.perTurn}\n\nAnswer from the knowledge above, in one or two plain sentences.` }
        : parts,
  },
];

function loadQueries(slug: string): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, "eval-sets", `${slug}.json`), "utf8"));
  const all: string[] = Array.isArray(raw) ? raw : (raw.queries ?? []);
  return all.slice(0, N);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f2 = (n: number) => (Number.isNaN(n) ? " — " : n.toFixed(2));
type Row = { variant: string; r?: EvalResult; err?: string };

async function main() {
  const character =
    (await getCharacterStore().getBySlug(CHARACTER)) ??
    (await getCharacterStore().getById(CHARACTER));
  if (!character) {
    console.error(`character "${CHARACTER}" not found`);
    process.exit(1);
  }
  const queries = loadQueries(character.slug);
  console.log(`═══ PROMPT-CONSTRUCTION SWEEP — ${character.title} ════════════════════`);
  console.log(`queries: ${queries.length}  ·  variants: ${VARIANTS.length}  ·  concurrency: ${CONC}`);
  console.log("(same model + retrieval for every variant — only the prompt assembly changes)\n");

  const pairs = VARIANTS.flatMap((v) => queries.map((q) => ({ v, q })));
  let done = 0;
  const results = await mapPool(pairs, CONC, async ({ v, q }): Promise<Row> => {
    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const r = await replayAndEval({
          characterId: character.id,
          message: q,
          constructionVariant: v.fn ?? undefined,
          axes: { grounding: true, quality: true },
        });
        done += 1;
        if (done % 4 === 0) console.log(`  …${done}/${pairs.length}`);
        return { variant: v.name, r };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (attempt < 3) await new Promise((res) => setTimeout(res, attempt * 2500));
      }
    }
    done += 1;
    return { variant: v.name, err: lastErr };
  });

  console.log("\n── COMPARISON (mean across queries; sorted by quality) ──────────────");
  console.log("variant                  faith  voice persona scope  QUAL  ok");
  const summary = VARIANTS.map((v) => {
    const rs = results.filter((x) => x.variant === v.name && x.r).map((x) => x.r!) as EvalResult[];
    const col = (sel: (r: EvalResult) => number | undefined) =>
      mean(rs.map(sel).filter((n): n is number => typeof n === "number" && !Number.isNaN(n)));
    return {
      v,
      ok: rs.length,
      faith: col((r) => r.grounding?.faithfulnessScore),
      voice: col((r) => r.quality?.voice.score),
      persona: col((r) => r.quality?.persona.score),
      scope: col((r) => r.quality?.scope.score),
      qual: col((r) => r.quality?.qualityScore),
    };
  }).sort((a, b) => (Number.isNaN(b.qual) ? -1 : b.qual) - (Number.isNaN(a.qual) ? -1 : a.qual));

  for (const s of summary) {
    console.log(
      `${s.v.name.padEnd(24)}${f2(s.faith)}   ${f2(s.voice)}  ${f2(s.persona)}   ${f2(s.scope)}  ${f2(s.qual)}  ${s.ok}/${queries.length}`,
    );
  }
  console.log("\nbaseline = current construction. voice≈tone · persona≈personality.");

  const report = {
    character: character.slug,
    at: new Date().toISOString(),
    queriesPerVariant: queries.length,
    variants: summary.map((s) => ({
      name: s.v.name,
      ok: s.ok,
      faithfulness: s.faith,
      voice: s.voice,
      persona: s.persona,
      scope: s.scope,
      quality: s.qual,
    })),
  };
  writeFileSync(join(process.cwd(), `construction-sweep-${character.slug}.json`), JSON.stringify(report, null, 2));
  console.log(`\nreport: construction-sweep-${character.slug}.json`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
