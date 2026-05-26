import { getCharacterStore, type CharacterBrainModel, type CharacterRecord } from "@odyssey/db";
import { runEvalSuite, type RunOptions } from "./runner";
import type { EvalRun, ProbeSuite } from "./types";

/**
 * Parameter sweep — runs the same probe suite N times with different
 * brainModel overrides, ranks the configs, surfaces the Pareto frontier
 * on (quality, latency, cost).
 *
 * Use case: "what's the best preset for these probes?" — grid-search
 * over models + temperatures + top_p + max_tokens, get a comparative
 * report.
 *
 * Honest scope of v1:
 *   - Grid search only (no Bayesian / no random / no early-stop).
 *   - Configs run serially (each suite internally parallelizes 4 probes).
 *     Running suites in parallel would compete for the same Anthropic
 *     quota; serial keeps the rate-limit story sane + makes progress
 *     legible.
 *   - "Best" = unweighted composite score across all probes. Future:
 *     per-dimension weighted composite.
 */

export type SweepSpec = {
  /** e.g. ["claude-sonnet-4-5", "claude-haiku-4-5"]. Always required. */
  model?: string[];
  temperature?: number[];
  topP?: number[];
  maxTokens?: number[];
  cacheControl?: boolean[];
};

export type SweepConfig = {
  /** Stable id for this config (e.g. "sonnet-4-5__t0.7__p1__mt1024__c1"). */
  id: string;
  /** The override that gets merged on top of the character's saved brainModel. */
  override: Partial<CharacterBrainModel>;
};

export type SweepProgress =
  | { kind: "sweep-plan"; configs: SweepConfig[] }
  | { kind: "config-start"; config: SweepConfig; index: number; total: number }
  | { kind: "config-done"; config: SweepConfig; run: EvalRun };

export type SweepRunOptions = Omit<RunOptions, "overrideConfig" | "onProgress"> & {
  /** The dimensions to expand. Cartesian product = configs to run. */
  sweep: SweepSpec;
  onSweepProgress?: (event: SweepProgress) => void;
};

export type SweepResult = {
  startedAt: string;
  completedAt: string;
  characterSlug: string;
  probeSuiteId: string;
  probeSuiteVersion: string;
  judgeModel: string;
  /** The original spec that produced the grid — needed for "re-run sweep". */
  spec: SweepSpec;
  configs: SweepConfig[];
  runs: EvalRun[];
  rankings: ConfigRanking[];
  pareto: ConfigRanking[];
};

export type ConfigRanking = {
  configId: string;
  override: Partial<CharacterBrainModel>;
  passed: number;
  total: number;
  errored: number;
  avgOverall: number;
  avgLatencyMs: number;
  estimatedCostUsd: number;
};

/* ── Public entrypoint ──────────────────────────────────── */

export async function runEvalSweep(opts: SweepRunOptions): Promise<SweepResult> {
  const startedAt = new Date().toISOString();
  const configs = expandSweep(opts.sweep);
  opts.onSweepProgress?.({ kind: "sweep-plan", configs });

  // Fetch the character ONCE up front. A multi-config sweep used to hit
  // the DB N times, and any single transient Neon hiccup would null-out
  // a config in the middle and nuke the whole sweep. Fetch + reuse.
  const character = await fetchCharacterOnce(opts.characterSlug);

  const runs: EvalRun[] = [];
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    opts.onSweepProgress?.({ kind: "config-start", config: cfg, index: i, total: configs.length });

    const runOpts: RunOptions = {
      characterSlug: opts.characterSlug,
      character,
      suite: opts.suite,
      overrideConfig: cfg.override,
    };
    if (opts.judgeModel) runOpts.judgeModel = opts.judgeModel;
    if (opts.probeIds) runOpts.probeIds = opts.probeIds;
    if (typeof opts.maxConcurrency === "number") {
      runOpts.maxConcurrency = opts.maxConcurrency;
    }
    const run = await runEvalSuite(runOpts);

    runs.push(run);
    opts.onSweepProgress?.({ kind: "config-done", config: cfg, run });
  }

  const completedAt = new Date().toISOString();
  const rankings = rankConfigs(configs, runs);
  const pareto = paretoFrontier(rankings);

  return {
    startedAt,
    completedAt,
    characterSlug: opts.characterSlug,
    probeSuiteId: opts.suite.id,
    probeSuiteVersion: opts.suite.version,
    judgeModel: opts.judgeModel ?? "claude-opus-4-5",
    spec: opts.sweep,
    configs,
    runs,
    rankings,
    pareto,
  };
}

/** Two-attempt character fetch. Mirrors the runner's helper but local
 * here so the sweep doesn't have to import a runner internal. */
async function fetchCharacterOnce(slug: string): Promise<CharacterRecord> {
  const store = getCharacterStore();
  let c = await store.getBySlug(slug);
  if (!c) {
    await new Promise((r) => setTimeout(r, 500));
    c = await store.getBySlug(slug);
  }
  if (!c) {
    throw new Error(
      `Character not found: ${slug} (sweep aborted before any config ran — verify slug + DB connectivity)`,
    );
  }
  return c;
}

/* ── Grid expansion ──────────────────────────────────────── */

/**
 * Cartesian product of every supplied dimension. Empty spec returns a
 * single "no-override" config so callers can use the sweep machinery
 * for one-off runs too.
 */
export function expandSweep(spec: SweepSpec): SweepConfig[] {
  const dims: Array<{ key: keyof CharacterBrainModel; values: unknown[] }> = [];
  if (spec.model?.length) dims.push({ key: "model", values: spec.model });
  if (spec.temperature?.length) dims.push({ key: "temperature", values: spec.temperature });
  if (spec.topP?.length) dims.push({ key: "topP", values: spec.topP });
  if (spec.maxTokens?.length) dims.push({ key: "maxTokens", values: spec.maxTokens });
  if (spec.cacheControl?.length) dims.push({ key: "cacheControl", values: spec.cacheControl });

  if (dims.length === 0) {
    return [{ id: "default", override: {} }];
  }

  // Build the cartesian product as a list of partial configs.
  let configs: Array<Partial<CharacterBrainModel>> = [{}];
  for (const dim of dims) {
    const next: Array<Partial<CharacterBrainModel>> = [];
    for (const config of configs) {
      for (const value of dim.values) {
        next.push({ ...config, [dim.key]: value });
      }
    }
    configs = next;
  }

  return configs.map((override) => ({
    id: formatConfigId(override),
    override,
  }));
}

/**
 * Stable, terse id from the override fields. Used in filenames + the
 * sweep report. Skips fields with default values for compactness.
 */
function formatConfigId(o: Partial<CharacterBrainModel>): string {
  const parts: string[] = [];
  if (o.model) parts.push(o.model.replace(/^claude-/, ""));
  if (typeof o.temperature === "number") parts.push(`t${o.temperature}`);
  if (typeof o.topP === "number") parts.push(`p${o.topP}`);
  if (typeof o.maxTokens === "number") parts.push(`mt${o.maxTokens}`);
  if (typeof o.cacheControl === "boolean") parts.push(`c${o.cacheControl ? 1 : 0}`);
  return parts.join("__") || "default";
}

/* ── Ranking ─────────────────────────────────────────────── */

function rankConfigs(configs: SweepConfig[], runs: EvalRun[]): ConfigRanking[] {
  const ranked = configs.map((cfg, i) => {
    const r = runs[i];
    return {
      configId: cfg.id,
      override: cfg.override,
      passed: r.summary.passed,
      total: r.summary.total,
      errored: r.summary.errored,
      avgOverall: r.summary.avgOverall,
      avgLatencyMs: r.summary.avgLatencyMs,
      estimatedCostUsd: r.summary.estimatedCostUsd,
    };
  });
  // Primary sort: passed count desc, then avg score desc, then latency asc, then cost asc.
  ranked.sort((a, b) => {
    if (a.passed !== b.passed) return b.passed - a.passed;
    if (a.avgOverall !== b.avgOverall) return b.avgOverall - a.avgOverall;
    if (a.avgLatencyMs !== b.avgLatencyMs) return a.avgLatencyMs - b.avgLatencyMs;
    return a.estimatedCostUsd - b.estimatedCostUsd;
  });
  return ranked;
}

/**
 * Pareto frontier on (quality higher = better, latency lower = better,
 * cost lower = better). A config is Pareto-optimal iff no other config
 * dominates it on all three axes simultaneously.
 *
 * Errored configs are excluded — a config where every probe errored
 * has $0 cost and 0ms latency, which would make it artificially
 * "Pareto-optimal" on those axes. Configs with partial errors are
 * still eligible (their cost/latency reflects only successful probes,
 * which understates them, but they're at least scoring real responses).
 *
 * For small grids (≤ 50 configs) the O(n²) check is fine.
 */
function paretoFrontier(rankings: ConfigRanking[]): ConfigRanking[] {
  const eligible = rankings.filter((r) => r.errored < r.total);
  return eligible.filter((a) => {
    return !eligible.some(
      (b) =>
        b !== a &&
        b.avgOverall >= a.avgOverall &&
        b.avgLatencyMs <= a.avgLatencyMs &&
        b.estimatedCostUsd <= a.estimatedCostUsd &&
        (b.avgOverall > a.avgOverall ||
          b.avgLatencyMs < a.avgLatencyMs ||
          b.estimatedCostUsd < a.estimatedCostUsd),
    );
  });
}
