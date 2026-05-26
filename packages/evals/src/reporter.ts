import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEvalStore, type SaveEvalRunInput } from "@odyssey/db";
import type { EvalRun, ProbeResult, ScoreDimension } from "./types";
import type { ConfigRanking, SweepResult } from "./sweep";

/**
 * Write an EvalRun to disk as both a JSON file (machine-readable,
 * exact replay) and a Markdown report (human-readable summary).
 *
 *   .evals/results/<character>/<run-id>.json
 *   .evals/results/<character>/<run-id>.md
 *   .evals/results/<character>/latest.md   (symlink-ish — overwritten)
 */
export type WriteResult = {
  jsonPath: string;
  mdPath: string;
  latestPath: string;
};

export function writeEvalRun(run: EvalRun, baseDir = ".evals"): WriteResult {
  const dir = join(baseDir, "results", run.characterSnapshot.characterSlug);
  mkdirSync(dir, { recursive: true });

  const jsonPath = join(dir, `${run.id}.json`);
  const mdPath = join(dir, `${run.id}.md`);
  const latestPath = join(dir, "latest.md");

  writeFileSync(jsonPath, JSON.stringify(run, null, 2));
  const markdown = renderMarkdown(run);
  writeFileSync(mdPath, markdown);
  writeFileSync(latestPath, markdown);

  return { jsonPath, mdPath, latestPath };
}

/* ── Markdown rendering ──────────────────────────────────── */

const DIMENSIONS: ScoreDimension[] = ["voice", "scope", "frame", "brevity", "factual"];

function renderMarkdown(run: EvalRun): string {
  const lines: string[] = [];
  const { characterSnapshot: snap, summary, effectiveModelConfig: cfg } = run;

  lines.push(`# Eval run — ${snap.characterTitle}`);
  lines.push("");
  lines.push(`**Run id:** \`${run.id}\``);
  lines.push(`**Started:** ${run.startedAt}`);
  lines.push(`**Completed:** ${run.completedAt}`);
  lines.push(`**Suite:** \`${run.probeSuiteId}\` v${run.probeSuiteVersion}`);
  lines.push(`**Judge:** \`${run.judgeModel}\``);
  lines.push(`**Character config hash:** \`${snap.configHash}\``);
  lines.push("");

  // ── Headline summary ──
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Probes | Passed | Failed | Errored | Avg overall | Avg latency | Cost (est) |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  lines.push(
    `| ${summary.total} | **${summary.passed}** | ${summary.failed} | ${summary.errored} | ${summary.avgOverall} / 5 | ${summary.avgLatencyMs} ms | $${summary.estimatedCostUsd} |`,
  );
  lines.push("");
  lines.push(
    `**Pass rate:** ${pct(summary.passed, summary.total)} (${summary.passed} / ${summary.total})`,
  );
  lines.push("");

  // ── Effective config ──
  lines.push(`## Config applied`);
  lines.push("");
  lines.push(`- **Model:** \`${cfg.model}\``);
  if (typeof cfg.temperature === "number") lines.push(`- **temperature:** ${cfg.temperature}`);
  if (typeof cfg.topP === "number") lines.push(`- **top_p:** ${cfg.topP}`);
  lines.push(`- **max_tokens:** ${cfg.maxTokens}`);
  lines.push(`- **cache_control:** ${cfg.cacheControl ? "enabled" : "off"}`);
  if (run.overrideConfig) {
    lines.push(`- **Override applied:** \`${JSON.stringify(run.overrideConfig)}\``);
  }
  lines.push("");

  // ── Per-category breakdown ──
  lines.push(`## By category`);
  lines.push("");
  lines.push(`| Category | n | Pass | Avg score |`);
  lines.push(`|---|---|---|---|`);
  const byCat = groupBy(run.probes, (p) => p.probeCategory);
  for (const [cat, probes] of Object.entries(byCat)) {
    const passed = probes.filter((p) => p.pass).length;
    const avg = round(probes.reduce((a, p) => a + p.overall, 0) / probes.length, 2);
    lines.push(`| ${cat} | ${probes.length} | ${passed}/${probes.length} (${pct(passed, probes.length)}) | ${avg} |`);
  }
  lines.push("");

  // ── Per-probe detail ──
  lines.push(`## Per-probe results`);
  lines.push("");
  for (const r of run.probes) {
    lines.push(renderProbeResult(r));
  }

  return lines.join("\n");
}

function renderProbeResult(r: ProbeResult): string {
  const lines: string[] = [];
  const passSign = r.pass ? "✓" : "✗";
  const errSign = r.errors.length > 0 ? " · ERRORED" : "";
  lines.push(`### ${passSign} \`${r.probeId}\` · ${r.probeCategory} · ${r.overall.toFixed(1)} / 5${errSign}`);
  lines.push("");
  lines.push(`**Input:** ${r.input}`);
  lines.push("");
  lines.push(`**Response** (${r.latencyMs}ms · in ${r.tokens.input} · out ${r.tokens.output} · cache ${r.tokens.cacheRead}):`);
  lines.push("");
  lines.push(blockQuote(r.response || "(no response)"));
  lines.push("");

  lines.push(`**Scores:**`);
  lines.push("");
  for (const d of DIMENSIONS) {
    const s = r.scores[d];
    lines.push(`- **${d}** ${s.score} / 5 — ${s.rationale}`);
  }
  lines.push("");
  lines.push(`**Judge:** ${r.rationale}`);

  if (r.mechanicalFailures.length > 0) {
    lines.push("");
    lines.push(`**Mechanical failures:**`);
    for (const m of r.mechanicalFailures) lines.push(`- ${m}`);
  }
  if (r.errors.length > 0) {
    lines.push("");
    lines.push(`**Errors:**`);
    for (const e of r.errors) lines.push(`- ${e}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

/* ── Console reporting (for live --watch mode later) ───── */

export function summaryLine(run: EvalRun): string {
  const s = run.summary;
  return `[${run.id}] ${s.passed}/${s.total} passed · avg ${s.avgOverall}/5 · ${s.avgLatencyMs}ms · $${s.estimatedCostUsd}`;
}

/* ── Sweep reporter ─────────────────────────────────────── */

export type WriteSweepResult = {
  jsonPath: string;
  mdPath: string;
  latestPath: string;
};

/**
 * Persist a sweep — one summary JSON + one Markdown report. Per-config
 * EvalRun details still live in their own `.evals/results/<char>/<run-id>.*`
 * files; the sweep summary cross-references them.
 */
export function writeSweepResult(sweep: SweepResult, baseDir = ".evals"): WriteSweepResult {
  const dir = join(baseDir, "sweeps", sweep.characterSlug);
  mkdirSync(dir, { recursive: true });

  const id = `sweep-${sweep.startedAt.replace(/[:.]/g, "-")}`;
  const jsonPath = join(dir, `${id}.json`);
  const mdPath = join(dir, `${id}.md`);
  const latestPath = join(dir, "latest.md");

  writeFileSync(jsonPath, JSON.stringify(sweep, null, 2));
  const md = renderSweepMarkdown(sweep);
  writeFileSync(mdPath, md);
  writeFileSync(latestPath, md);

  return { jsonPath, mdPath, latestPath };
}

function renderSweepMarkdown(sweep: SweepResult): string {
  const lines: string[] = [];
  lines.push(`# Sweep — ${sweep.characterSlug}`);
  lines.push("");
  lines.push(`**Started:** ${sweep.startedAt}`);
  lines.push(`**Completed:** ${sweep.completedAt}`);
  lines.push(`**Suite:** \`${sweep.probeSuiteId}\` v${sweep.probeSuiteVersion}`);
  lines.push(`**Judge:** \`${sweep.judgeModel}\``);
  lines.push(`**Configs:** ${sweep.configs.length}`);
  lines.push("");

  // ── Ranking ──
  lines.push(`## Ranking`);
  lines.push("");
  lines.push(`Sorted by passed-count desc → avg score desc → latency asc → cost asc.`);
  lines.push("");
  lines.push(`| # | Config | Passed | Errored | Avg | Latency | Cost | Pareto |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  const paretoIds = new Set(sweep.pareto.map((p) => p.configId));
  sweep.rankings.forEach((r, i) => {
    const onPareto = paretoIds.has(r.configId) ? "✓" : "";
    const erroredCell = r.errored > 0 ? `**${r.errored}**` : "0";
    lines.push(
      `| ${i + 1} | \`${r.configId}\` | ${r.passed}/${r.total} | ${erroredCell} | ${r.avgOverall.toFixed(2)} | ${r.avgLatencyMs}ms | $${r.estimatedCostUsd} | ${onPareto} |`,
    );
  });
  lines.push("");

  // ── Excluded from Pareto ──
  const fullyErrored = sweep.rankings.filter(
    (r) => r.total > 0 && r.errored >= r.total,
  );
  if (fullyErrored.length > 0) {
    lines.push(`### Excluded from Pareto`);
    lines.push("");
    lines.push(
      `These configs errored on every probe (so their $0 cost + 0ms latency ` +
        `would otherwise dominate the frontier artificially). Re-run them ` +
        `before reading the rankings as final.`,
    );
    lines.push("");
    for (const r of fullyErrored) {
      lines.push(`- \`${r.configId}\` — ${r.errored}/${r.total} errored`);
    }
    lines.push("");
  }

  // ── Pareto frontier ──
  lines.push(`## Pareto frontier`);
  lines.push("");
  lines.push(
    `Configs that aren't dominated on all three of (quality, latency, cost) by any other. ` +
      `These are the only configs worth picking from — every config NOT on the frontier ` +
      `is strictly worse than at least one on it. Fully-errored configs are excluded.`,
  );
  lines.push("");
  if (sweep.pareto.length === 0) {
    lines.push(`_(none — all configs are dominated or errored out)_`);
  } else {
    lines.push(`| Config | Avg | Latency | Cost |`);
    lines.push(`|---|---|---|---|`);
    for (const p of sweep.pareto) {
      lines.push(
        `| \`${p.configId}\` | ${p.avgOverall.toFixed(2)} | ${p.avgLatencyMs}ms | $${p.estimatedCostUsd} |`,
      );
    }
  }
  lines.push("");

  // ── Per-config detail ──
  lines.push(`## Per-config detail`);
  lines.push("");
  for (let i = 0; i < sweep.configs.length; i++) {
    const cfg = sweep.configs[i];
    const run = sweep.runs[i];
    lines.push(`### \`${cfg.id}\``);
    lines.push("");
    lines.push(`**Override:** \`${JSON.stringify(cfg.override)}\``);
    lines.push(`**Run:** \`${run.id}\``);
    const errSuffix = run.summary.errored > 0 ? ` · **⚠ ${run.summary.errored} errored**` : "";
    lines.push(`**Summary:** ${run.summary.passed}/${run.summary.total} passed · avg ${run.summary.avgOverall}/5 · ${run.summary.avgLatencyMs}ms · $${run.summary.estimatedCostUsd}${errSuffix}`);
    lines.push("");
    // Per-category breakdown for quick scanning
    const byCat = groupByCategory(run.probes);
    lines.push(`| Category | Pass | Avg |`);
    lines.push(`|---|---|---|`);
    for (const [cat, probes] of Object.entries(byCat)) {
      const passed = probes.filter((p) => p.pass).length;
      const avg = round(probes.reduce((a, p) => a + p.overall, 0) / probes.length, 2);
      lines.push(`| ${cat} | ${passed}/${probes.length} | ${avg} |`);
    }
    lines.push("");
    // List errored probes so the user can see what failed without
    // having to open the per-config JSON.
    const errored = run.probes.filter((p) => p.errors.length > 0);
    if (errored.length > 0) {
      lines.push(`**Errored probes:**`);
      for (const p of errored) {
        lines.push(`- \`${p.probeId}\` — ${p.errors.join("; ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function groupByCategory(probes: ProbeResult[]): Record<string, ProbeResult[]> {
  const out: Record<string, ProbeResult[]> = {};
  for (const p of probes) {
    if (!out[p.probeCategory]) out[p.probeCategory] = [];
    out[p.probeCategory].push(p);
  }
  return out;
}

/* ── Helpers ─────────────────────────────────────────── */

function pct(n: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

function round(n: number, places: number): number {
  const k = Math.pow(10, places);
  return Math.round(n * k) / k;
}

function blockQuote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

/* ── DB persistence ───────────────────────────────────────── */

/**
 * Result of a DB-write attempt. `skipped: true` (with a reason) means the
 * write didn't fail per se — the run is still on disk, but the suite hasn't
 * been published to `eval_suites` yet, so we have nothing to FK to. CLI
 * users can ignore this; the runs page just won't show those runs.
 */
export type WriteDbResult =
  | { ok: true; runId: string }
  | { ok: false; skipped: true; reason: string };

export type WriteSweepDbResult =
  | { ok: true; sweepId: string; runIds: string[] }
  | { ok: false; skipped: true; reason: string };

/**
 * Persist an EvalRun to the DB (eval_runs + eval_probe_results).
 *
 * Looks up the matching `eval_suites` row by (characterId, suite.id,
 * suite.version) and FKs the run to it. If no published suite is found
 * (e.g. CLI run before the seed script was applied), we skip the DB
 * write rather than failing — the file outputs are still there.
 *
 * Returns the new run id on success, or a skip reason if no suite match.
 */
export async function writeEvalRunToDb(run: EvalRun): Promise<WriteDbResult> {
  const store = getEvalStore();
  const characterId = run.characterSnapshot.characterId;

  // Suite must already be published — see seed-abraham-eval-suite.ts.
  // We look up the latest version with this slug, then verify the version
  // matches the run's `probeSuiteVersion`. Mismatch = a more recent
  // version was published; we still write against the matching version
  // if it exists, but `getLatestSuiteBySlug` only returns the newest.
  // For now a strict match is fine; we can search by exact version if
  // we ever need multi-version coexistence.
  const suite = await store.getLatestSuiteBySlug(characterId, run.probeSuiteId);
  if (!suite) {
    return {
      ok: false,
      skipped: true,
      reason: `No published suite for character ${characterId} slug "${run.probeSuiteId}" — seed it first (see scripts/seed-abraham-eval-suite.ts).`,
    };
  }
  if (suite.version !== run.probeSuiteVersion) {
    return {
      ok: false,
      skipped: true,
      reason: `Latest published suite is v${suite.version}, but this run used v${run.probeSuiteVersion}. Re-publish to align.`,
    };
  }

  const input: SaveEvalRunInput = {
    characterId,
    suiteId: suite.id,
    characterSnapshot: run.characterSnapshot,
    configHash: run.characterSnapshot.configHash,
    overrideConfig: run.overrideConfig,
    effectiveModelConfig: run.effectiveModelConfig,
    judgeModel: run.judgeModel,
    source: "single",
    summary: run.summary,
    probes: run.probes.map(probeResultToDbInput),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };

  const saved = await store.saveRun(input);
  return { ok: true, runId: saved.id };
}

/**
 * Persist a SweepResult — sweep header + every child run + all probe
 * results — in one transaction. Same suite-lookup rules as
 * `writeEvalRunToDb`.
 */
export async function writeSweepResultToDb(
  sweep: SweepResult,
): Promise<WriteSweepDbResult> {
  if (sweep.runs.length === 0) {
    return { ok: false, skipped: true, reason: "Sweep has no runs to persist." };
  }

  const store = getEvalStore();
  const characterId = sweep.runs[0].characterSnapshot.characterId;

  const suite = await store.getLatestSuiteBySlug(characterId, sweep.probeSuiteId);
  if (!suite) {
    return {
      ok: false,
      skipped: true,
      reason: `No published suite for character ${characterId} slug "${sweep.probeSuiteId}" — seed it first.`,
    };
  }
  if (suite.version !== sweep.probeSuiteVersion) {
    return {
      ok: false,
      skipped: true,
      reason: `Latest published suite is v${suite.version}, sweep used v${sweep.probeSuiteVersion}. Re-publish to align.`,
    };
  }

  // Pair each config with its run for the saveSweep input. The two arrays
  // are aligned by position — runs[i] is the result of configs[i].
  const runs = sweep.runs.map((run, i) => {
    const config = sweep.configs[i];
    return {
      configId: config.id,
      characterSnapshot: run.characterSnapshot,
      configHash: run.characterSnapshot.configHash,
      overrideConfig: run.overrideConfig,
      effectiveModelConfig: run.effectiveModelConfig,
      summary: run.summary,
      probes: run.probes.map(probeResultToDbInput),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
  });

  const result = await store.saveSweep({
    characterId,
    suiteId: suite.id,
    judgeModel: sweep.judgeModel,
    spec: sweep.spec,
    configs: sweep.configs,
    rankings: sweep.rankings,
    pareto: sweep.pareto,
    runs,
    startedAt: sweep.startedAt,
    completedAt: sweep.completedAt,
  });

  return { ok: true, sweepId: result.sweepId, runIds: result.runIds };
}

function probeResultToDbInput(p: ProbeResult) {
  return {
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
  };
}
