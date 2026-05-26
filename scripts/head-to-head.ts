/**
 * One-shot head-to-head comparison.
 *
 * Runs N evals of each configured model, prints a summary table with
 * mean/std-dev pass count + avg score, and reports any errored probes.
 *
 * Why a script instead of the sweep machinery: sweep's `expandSweep`
 * cartesian-products; passing the same model twice would just produce
 * one config. This script intentionally re-runs the same config N times
 * to smooth out per-run noise (Anthropic latency spikes, judge calls
 * that hit a tail).
 *
 * Reads `DEFAULT_PRESETS` from the file rather than CLI args — quick
 * to tweak by hand, no flag parsing.
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { runEvalSuite, writeEvalRun } from "@odyssey/evals";
import { abrahamSuite } from "../evals/abraham/suite";

type Trial = {
  label: string;
  model: string;
  temperature?: number;
  runs: number;
};

const TRIALS: Trial[] = [
  // Re-test ONLY GPT-OSS after tightening Abraham's directive (added a
  // crisis-voice `never` rule + explicit crisis-response structure in
  // `guidance`). The fix targets the two consistent misses surfaced by
  // the previous head-to-head — edge-crisis (2/3 fail, voice broke into
  // generic-hotline register) and id-tell-me (2/3 fail, missed tent-elder
  // greeting cadence). Sonnet's baseline is already established at 19/20
  // and Haiku rate-limits when run back-to-back, so this run is just
  // GPT-OSS × 3 to measure variance collapse.
  { label: "gpt-oss-120b (post-directive-tighten)", model: "gpt-oss-120b", runs: 3 },
];

const JUDGE = "claude-sonnet-4-5";

type RunResult = {
  passed: number;
  total: number;
  avgOverall: number;
  avgLatencyMs: number;
  cost: number;
  errored: number;
};

async function main() {
  console.log(`Head-to-head · suite ${abrahamSuite.id} v${abrahamSuite.version} · judge ${JUDGE}`);
  console.log("");

  const results = new Map<string, RunResult[]>();

  for (const trial of TRIALS) {
    console.log(`── ${trial.label} (${trial.runs} run${trial.runs === 1 ? "" : "s"}) ──`);
    const trialResults: RunResult[] = [];

    for (let i = 1; i <= trial.runs; i++) {
      const runOpts: Parameters<typeof runEvalSuite>[0] = {
        characterSlug: "abraham",
        suite: abrahamSuite,
        judgeModel: JUDGE,
        overrideConfig: {
          model: trial.model,
          ...(typeof trial.temperature === "number" ? { temperature: trial.temperature } : {}),
        },
        // Conservative concurrency — the multi-provider sweep collapsed
        // at 4. Two keeps Anthropic from rate-limiting + leaves headroom
        // for the curator's parallel wiki reads.
        maxConcurrency: 2,
      };
      const run = await runEvalSuite(runOpts);
      writeEvalRun(run);

      const summary: RunResult = {
        passed: run.summary.passed,
        total: run.summary.total,
        avgOverall: run.summary.avgOverall,
        avgLatencyMs: run.summary.avgLatencyMs,
        cost: run.summary.estimatedCostUsd,
        errored: run.summary.errored,
      };
      trialResults.push(summary);

      console.log(
        `  run ${i}/${trial.runs}: ${summary.passed}/${summary.total} passed · ` +
        `avg ${summary.avgOverall.toFixed(2)}/5 · ${summary.avgLatencyMs}ms · ` +
        `$${summary.cost.toFixed(4)}` +
        (summary.errored > 0 ? ` · ⚠ ${summary.errored} errored` : ""),
      );
    }

    results.set(trial.label, trialResults);
    console.log("");
  }

  // ── Summary table ──
  console.log("─── Summary ───");
  console.log("");
  for (const [label, rs] of results.entries()) {
    const meanPass = rs.reduce((a, r) => a + r.passed, 0) / rs.length;
    const meanAvg = rs.reduce((a, r) => a + r.avgOverall, 0) / rs.length;
    const meanLat = rs.reduce((a, r) => a + r.avgLatencyMs, 0) / rs.length;
    const meanCost = rs.reduce((a, r) => a + r.cost, 0) / rs.length;
    const passStd = stddev(rs.map((r) => r.passed));
    const erroredTotal = rs.reduce((a, r) => a + r.errored, 0);

    console.log(
      `${label.padEnd(34)} mean ${meanPass.toFixed(1)}/20 (σ ${passStd.toFixed(1)}) · ` +
      `avg ${meanAvg.toFixed(2)}/5 · ${Math.round(meanLat)}ms · ` +
      `$${meanCost.toFixed(4)}/run` +
      (erroredTotal > 0 ? ` · ⚠ ${erroredTotal} total err` : ""),
    );
  }
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

main().catch((err) => {
  console.error("Head-to-head failed:");
  console.error(err);
  process.exit(1);
});
