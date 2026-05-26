/**
 * CLI for @odyssey/evals.
 *
 * Usage:
 *   npx tsx scripts/eval.ts abraham                              # full suite
 *   npx tsx scripts/eval.ts abraham --probe id-tell-me           # single probe
 *   npx tsx scripts/eval.ts abraham --probe id-tell-me,id-name   # subset
 *   npx tsx scripts/eval.ts abraham --config '{"temperature":0.5}'  # override
 *   npx tsx scripts/eval.ts abraham --judge claude-sonnet-4-5    # cheaper judge
 *
 * Output:
 *   .evals/results/<character>/<run-id>.json   ← machine-readable
 *   .evals/results/<character>/<run-id>.md     ← human-readable
 *   .evals/results/<character>/latest.md        ← always the most recent
 */

// Force-override existing env vars — the user's shell sometimes has
// ANTHROPIC_API_KEY set to empty (or stale), which `dotenv/config` would
// otherwise defer to and leave us without a real key.
import * as dotenv from "dotenv";
dotenv.config({ override: true });

import {
  runEvalSuite,
  runEvalSweep,
  summaryLine,
  writeEvalRun,
  writeEvalRunToDb,
  writeSweepResult,
  writeSweepResultToDb,
  type SweepSpec,
} from "@odyssey/evals";
import { abrahamSuite } from "../evals/abraham/suite";

type SuiteRegistry = Record<string, typeof abrahamSuite>;

const SUITES: SuiteRegistry = {
  abraham: abrahamSuite,
};

/* ── Args ──────────────────────────────────────────────── */

const args = process.argv.slice(2);
const characterSlug = args[0];

if (!characterSlug || characterSlug === "--help" || characterSlug === "-h") {
  printHelp();
  process.exit(0);
}

const suite = SUITES[characterSlug];
if (!suite) {
  console.error(`No probe suite registered for "${characterSlug}".`);
  console.error(`Available: ${Object.keys(SUITES).join(", ")}`);
  process.exit(1);
}

const probeFlag = readFlag("--probe");
const configFlag = readFlag("--config");
const judgeFlag = readFlag("--judge");
const concurrencyFlag = readFlag("--concurrency");
const sweepFlag = readFlag("--sweep");

const probeIds = probeFlag ? probeFlag.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
const overrideConfig = configFlag ? parseConfigJson(configFlag) : undefined;
const judgeModel = judgeFlag || "claude-opus-4-5";
const maxConcurrency = concurrencyFlag ? Math.max(1, parseInt(concurrencyFlag, 10)) : undefined;
const sweep = sweepFlag ? parseSweepJson(sweepFlag) : undefined;

/* ── Run ───────────────────────────────────────────────── */

async function main() {
  if (sweep) {
    await runSweep();
    return;
  }
  await runSingle();
}

async function runSingle() {
  console.log(`\nEvaluating ${characterSlug} · suite ${suite.id} v${suite.version}`);
  console.log(`Probes: ${probeIds?.length ?? suite.probes.length} / ${suite.probes.length}`);
  console.log(`Judge: ${judgeModel}`);
  if (overrideConfig) console.log(`Config override: ${JSON.stringify(overrideConfig)}`);
  console.log("");

  const startedAt = Date.now();
  let probeCount = 0;
  const totalProbes = probeIds?.length ?? suite.probes.length;

  const opts: Parameters<typeof runEvalSuite>[0] = {
    characterSlug,
    suite,
    judgeModel,
    onProgress: (e) => {
      if (e.kind === "snapshot") {
        console.log(`Snapshot captured · config hash ${e.snapshot.configHash}`);
        console.log("");
      } else if (e.kind === "probe-start") {
        // Could log here, but per-probe-done lines below are tidier.
      } else if (e.kind === "probe-done") {
        probeCount++;
        const sign = e.result.pass ? "✓" : "✗";
        const err = e.result.errors.length > 0 ? " · ERR" : "";
        console.log(
          `  [${probeCount}/${totalProbes}] ${sign} ${e.result.probeId.padEnd(24)} ` +
            `${e.result.overall.toFixed(1)}/5 · ${e.result.latencyMs.toString().padStart(5)}ms${err}`,
        );
      }
    },
  };
  if (probeIds) opts.probeIds = probeIds;
  if (overrideConfig) opts.overrideConfig = overrideConfig;
  if (typeof maxConcurrency === "number") opts.maxConcurrency = maxConcurrency;

  const run = await runEvalSuite(opts);

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log(summaryLine(run));
  console.log(`Wall: ${elapsedSec}s`);
  console.log("");

  const { jsonPath, mdPath, latestPath } = writeEvalRun(run);
  console.log(`Wrote:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
  console.log(`  ${latestPath}`);

  // Mirror to DB. Soft-fail if the suite isn't published yet — the file
  // artifacts above are still useful, the user just won't see this run
  // in the harness UI until they run the seed script.
  const dbResult = await writeEvalRunToDb(run);
  if (dbResult.ok) {
    console.log(`  db:eval_runs/${dbResult.runId}`);
  } else {
    console.log(`  db: skipped — ${dbResult.reason}`);
  }
  console.log("");
}

async function runSweep() {
  if (!sweep) return;
  const probes = probeIds?.length ?? suite.probes.length;

  console.log(`\nSweeping ${characterSlug} · suite ${suite.id} v${suite.version}`);
  console.log(`Sweep spec: ${JSON.stringify(sweep)}`);
  console.log(`Probes per config: ${probes}`);
  console.log(`Judge: ${judgeModel}`);
  console.log("");

  const startedAt = Date.now();
  let configIndex = 0;
  let totalConfigs = 0;

  const opts: Parameters<typeof runEvalSweep>[0] = {
    characterSlug,
    suite,
    sweep,
    judgeModel,
    onSweepProgress: (e) => {
      if (e.kind === "sweep-plan") {
        totalConfigs = e.configs.length;
        const estCost = (totalConfigs * probes * 0.015).toFixed(2); // rough
        const estMins = Math.ceil((totalConfigs * probes * 12) / 60 / 4); // 12s/probe, conc 4
        console.log(`Plan: ${totalConfigs} configs · est ~$${estCost} · est ~${estMins} min wall`);
        console.log("");
        e.configs.forEach((c, i) => console.log(`  ${i + 1}. ${c.id}`));
        console.log("");
      } else if (e.kind === "config-start") {
        configIndex = e.index + 1;
        console.log(`\n[config ${configIndex}/${totalConfigs}] ${e.config.id}`);
        console.log(`  override: ${JSON.stringify(e.config.override)}`);
      } else if (e.kind === "config-done") {
        const s = e.run.summary;
        const errSuffix = s.errored > 0 ? ` · ⚠ ${s.errored} errored` : "";
        console.log(`  → ${s.passed}/${s.total} passed · avg ${s.avgOverall}/5 · ${s.avgLatencyMs}ms · $${s.estimatedCostUsd}${errSuffix}`);
      }
    },
  };
  if (probeIds) opts.probeIds = probeIds;
  if (typeof maxConcurrency === "number") opts.maxConcurrency = maxConcurrency;

  const result = await runEvalSweep(opts);
  const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);

  console.log("");
  console.log("─── Sweep complete ───");
  console.log("");
  console.log(`Top 5 configs (passed → avg → latency → cost):`);
  result.rankings.slice(0, 5).forEach((r, i) => {
    const onPareto = result.pareto.some((p) => p.configId === r.configId) ? " ✓" : "";
    const errSuffix = r.errored > 0 ? ` · ⚠ ${r.errored} err` : "";
    console.log(
      `  ${i + 1}. ${r.configId.padEnd(36)} ${r.passed}/${r.total} · ${r.avgOverall.toFixed(2)}/5 · ${r.avgLatencyMs}ms · $${r.estimatedCostUsd}${errSuffix}${onPareto}`,
    );
  });
  console.log("");
  // Excluded-from-Pareto callout: helps the user notice when a config errored
  // out so heavily it can't be ranked on the frontier.
  const excluded = result.rankings.filter(
    (r) => r.errored >= r.total && r.total > 0,
  );
  if (excluded.length > 0) {
    console.log(`Excluded from Pareto (all probes errored — re-run these):`);
    excluded.forEach((r) => console.log(`  ${r.configId} · ${r.errored}/${r.total} errored`));
    console.log("");
  }
  console.log(`Pareto frontier (${result.pareto.length} configs):`);
  result.pareto.forEach((p) => {
    console.log(`  ${p.configId}`);
  });
  console.log("");
  console.log(`Wall: ${elapsedMin} min`);

  // Also persist every run's individual report — they're useful for drilling
  // into failures of any specific config.
  for (const run of result.runs) writeEvalRun(run);

  const { jsonPath, mdPath, latestPath } = writeSweepResult(result);
  console.log("");
  console.log(`Wrote:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
  console.log(`  ${latestPath}`);

  // Mirror to DB — sweep + all child runs in one transaction.
  // Skips cleanly if no suite is published; files above are intact either way.
  const dbResult = await writeSweepResultToDb(result);
  if (dbResult.ok) {
    console.log(`  db:eval_sweeps/${dbResult.sweepId} (+ ${dbResult.runIds.length} runs)`);
  } else {
    console.log(`  db: skipped — ${dbResult.reason}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("\nEval run failed:");
  console.error(err);
  process.exit(1);
});

/* ── Arg helpers ───────────────────────────────────────── */

function readFlag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

function parseConfigJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error(`--config must be valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function parseSweepJson(raw: string): SweepSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`--sweep must be valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("--sweep must be a JSON object of arrays");
    process.exit(1);
  }
  const obj = parsed as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (!Array.isArray(v)) {
      console.error(`--sweep field "${k}" must be an array (e.g. {"temperature":[0.3,0.7]})`);
      process.exit(1);
    }
  }
  return obj as SweepSpec;
}

function printHelp() {
  console.log(`
@odyssey/evals — character regression + behavior suite

Usage:
  npx tsx scripts/eval.ts <character> [flags]

Characters available:
  ${Object.keys(SUITES).join(", ")}

Flags:
  --probe <id[,id…]>   Run only the listed probe ids
  --config <json>      Override brainModel for this run (e.g. '{"temperature":0.5}')
  --sweep <json>       Grid-search over arrays of values. Cartesian product.
                       e.g. '{"model":["claude-sonnet-4-5","claude-haiku-4-5"],
                              "temperature":[0.3,0.7,1.0]}'
                       Outputs ranked configs + Pareto frontier.
  --judge <model>      Judge model (default claude-opus-4-5)
  --concurrency <n>    Max in-flight probes (default 4)

Output:
  Single run:
    .evals/results/<character>/<run-id>.json + .md, latest.md

  Sweep:
    .evals/results/<character>/<run-id>.{json,md}   (one per config)
    .evals/sweeps/<character>/sweep-<ts>.{json,md}, latest.md
`);
}
