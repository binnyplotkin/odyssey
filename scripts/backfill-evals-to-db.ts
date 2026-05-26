/**
 * Backfill historical .evals/ JSON output into the DB.
 *
 * The eval harness wrote JSON files long before the DB tables existed. This
 * script reads every `.evals/results/<char>/*.json` and `.evals/sweeps/<char>/*.json`,
 * parses each into the runtime types, and inserts via the eval store.
 *
 * Idempotent-ish: skips runs whose (configHash, startedAt) already exists.
 * Sweep dedup is by startedAt — sweeps are unique enough by timestamp.
 *
 * Usage:
 *   npx tsx scripts/backfill-evals-to-db.ts
 *   npx tsx scripts/backfill-evals-to-db.ts --dry-run    # report only
 *   npx tsx scripts/backfill-evals-to-db.ts --slug abraham   # one character
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getCharacterStore, getEvalStore } from "@odyssey/db";
import type { EvalRun } from "@odyssey/evals";
import type { SweepResult } from "@odyssey/evals/dist/sweep";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const slugFlag = (() => {
  const i = args.indexOf("--slug");
  return i >= 0 ? args[i + 1] : undefined;
})();

const EVAL_DIR = ".evals";

async function main() {
  const resultsRoot = join(EVAL_DIR, "results");
  const sweepsRoot = join(EVAL_DIR, "sweeps");

  const slugs = slugFlag ? [slugFlag] : readDirIfExists(resultsRoot);

  let runsImported = 0;
  let runsSkipped = 0;
  let sweepsImported = 0;
  let sweepsSkipped = 0;

  for (const slug of slugs) {
    console.log(`\n[character: ${slug}]`);

    const character = await getCharacterStore().getBySlug(slug);
    if (!character) {
      console.log(`  ⚠ character not in DB, skipping`);
      continue;
    }

    const suite = await getEvalStore().getLatestSuiteBySlug(character.id, slug);
    if (!suite) {
      console.log(`  ⚠ no published suite for "${slug}" — run scripts/seed-${slug}-eval-suite.ts first`);
      continue;
    }
    console.log(`  ✓ suite ${suite.slug} v${suite.version} (${(suite.probes as unknown[]).length} probes)`);

    // ── Sweeps FIRST so child run inserts can FK to the new sweep_id ──
    const sweepsDir = join(sweepsRoot, slug);
    const sweepFiles = readDirIfExists(sweepsDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    // Track which runs were part of a sweep (by id) so we don't re-import
    // them as standalone runs in the second pass.
    const sweepRunIds = new Set<string>();

    for (const fname of sweepFiles) {
      const path = join(sweepsDir, fname);
      const sweep = readJson<SweepResult>(path);
      if (!sweep) {
        console.log(`  · ${fname} — failed to parse, skipping`);
        continue;
      }

      // Dedup: same character + startedAt already imported?
      const existing = await getEvalStore().listSweeps(character.id);
      const dup = existing.find((s) => s.startedAt === sweep.startedAt);
      if (dup) {
        sweepsSkipped++;
        sweep.runs.forEach((r) => sweepRunIds.add(r.id));
        continue;
      }

      // Suite version mismatch — would FK-orphan future runs against this
      // suite. Skip with a note; manual fix is bumping the seeded version.
      if (sweep.probeSuiteVersion !== suite.version) {
        console.log(`  · ${fname} — suite version mismatch (file: ${sweep.probeSuiteVersion}, db: ${suite.version}), skipping`);
        continue;
      }

      if (dryRun) {
        console.log(`  · DRY ${fname} — would import sweep (${sweep.configs.length} configs · ${sweep.runs.length} runs)`);
        sweep.runs.forEach((r) => sweepRunIds.add(r.id));
        sweepsImported++;
        continue;
      }

      const result = await getEvalStore().saveSweep({
        characterId: character.id,
        suiteId: suite.id,
        judgeModel: sweep.judgeModel,
        spec: sweep.spec ?? {},     // older files may not have `spec` — write empty object
        configs: sweep.configs,
        rankings: sweep.rankings,
        pareto: sweep.pareto,
        runs: sweep.runs.map((r, i) => ({
          configId: sweep.configs[i]?.id ?? `config-${i}`,
          characterSnapshot: r.characterSnapshot,
          configHash: r.characterSnapshot.configHash,
          overrideConfig: r.overrideConfig,
          effectiveModelConfig: r.effectiveModelConfig,
          summary: r.summary,
          probes: r.probes.map((p) => ({
            probeId: p.probeId,
            probeCategory: p.probeCategory,
            input: p.input,
            response: p.response,
            scores: p.scores,
            overall: p.overall,
            pass: p.pass,
            rationale: p.rationale,
            mechanicalFailures: p.mechanicalFailures,
            errors: p.errors,
            latencyMs: p.latencyMs,
            tokens: p.tokens,
          })),
          startedAt: r.startedAt,
          completedAt: r.completedAt,
        })),
        startedAt: sweep.startedAt,
        completedAt: sweep.completedAt,
      });
      sweep.runs.forEach((r) => sweepRunIds.add(r.id));
      sweepsImported++;
      console.log(`  ✓ ${fname} → sweep ${result.sweepId.slice(0, 8)}… (+ ${result.runIds.length} runs)`);
    }

    // ── Standalone runs second ──────────────────────────────────────
    const runsDir = join(resultsRoot, slug);
    const runFiles = readDirIfExists(runsDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    // Existing runs in DB — dedup by (configHash, startedAt) within character.
    const existingRuns = await getEvalStore().listRuns({ characterId: character.id, limit: 100 });
    const existingKey = new Set(
      existingRuns.map((r) => `${r.configHash}|${r.startedAt}`),
    );

    for (const fname of runFiles) {
      const path = join(runsDir, fname);
      const run = readJson<EvalRun>(path);
      if (!run) {
        console.log(`  · ${fname} — failed to parse, skipping`);
        continue;
      }

      // Was this run already imported as part of a sweep?
      if (sweepRunIds.has(run.id)) {
        runsSkipped++;
        continue;
      }

      const key = `${run.characterSnapshot.configHash}|${run.startedAt}`;
      if (existingKey.has(key)) {
        runsSkipped++;
        continue;
      }

      if (run.probeSuiteVersion !== suite.version) {
        console.log(`  · ${fname} — suite version mismatch (file: ${run.probeSuiteVersion}, db: ${suite.version}), skipping`);
        continue;
      }

      if (dryRun) {
        console.log(`  · DRY ${fname} — would import run (${run.summary.passed}/${run.summary.total})`);
        runsImported++;
        continue;
      }

      const saved = await getEvalStore().saveRun({
        characterId: character.id,
        suiteId: suite.id,
        characterSnapshot: run.characterSnapshot,
        configHash: run.characterSnapshot.configHash,
        overrideConfig: run.overrideConfig,
        effectiveModelConfig: run.effectiveModelConfig,
        judgeModel: run.judgeModel,
        source: "single",
        summary: run.summary,
        probes: run.probes.map((p) => ({
          probeId: p.probeId,
          probeCategory: p.probeCategory,
          input: p.input,
          response: p.response,
          scores: p.scores,
          overall: p.overall,
          pass: p.pass,
          rationale: p.rationale,
          mechanicalFailures: p.mechanicalFailures,
          errors: p.errors,
          latencyMs: p.latencyMs,
          tokens: p.tokens,
        })),
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      });
      runsImported++;
      console.log(`  ✓ ${fname} → run ${saved.id.slice(0, 8)}…`);
    }
  }

  console.log("\n─── Backfill complete ───");
  console.log(`  Sweeps:  ${sweepsImported} imported · ${sweepsSkipped} skipped (dup)`);
  console.log(`  Runs:    ${runsImported} imported · ${runsSkipped} skipped (dup or part of sweep)`);
  if (dryRun) console.log(`  [dry run — no actual writes]`);
}

function readDirIfExists(path: string): string[] {
  try {
    if (!statSync(path).isDirectory()) return [];
    return readdirSync(path);
  } catch {
    return [];
  }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("Backfill failed:");
  console.error(err);
  process.exit(1);
});
