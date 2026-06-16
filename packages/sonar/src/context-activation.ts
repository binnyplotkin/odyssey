import * as fs from "node:fs";
import * as path from "node:path";

import { aggregate } from "./stats";
import { SUITES } from "./suites";
import type { SonarAggregate, SonarRunRecord, SonarTurnRecord, TraceContractEvent } from "./types";

export const CONTEXT_ACTIVATION_SCORES_PATH = "evals/sonar/context-activation-scores.jsonl";

export const CONTEXT_ACTIVATION_DIMENSIONS = [
  "contextAvailability",
  "retrievalRecall",
  "retrievalPrecision",
  "curationSelectivity",
  "tokenEfficiency",
  "cacheEffectiveness",
  "retrievalLatency",
  "curatorLatency",
  "contextAttachLatency",
] as const;

export type ContextActivationDimension = (typeof CONTEXT_ACTIVATION_DIMENSIONS)[number];

export type ContextActivationMetrics = {
  turns: number;
  tracedTurns: number;
  contextTurns: number;
  retrievalTurns: number;
  cacheEligibleTurns: number;
  cacheHits: number;
  staleCacheMisses: number;
  retrievalSkippedTurns: number;
  labeledTurns: number;
  pageRecall: number | null;
  pagePrecision: number | null;
  forbiddenPageHits: number;
  selectedPageSlugs: string[];
  expectedPageSlugs: string[];
  avgSemanticHits: number | null;
  avgSelectedPages: number | null;
  avgWikiPromptChars: number | null;
  avgTokenBudgetUse: number | null;
  retrievalMs: SonarAggregate | null;
  curatorMs: SonarAggregate | null;
  contextAttachMs: SonarAggregate | null;
};

export type ContextActivationScoreRecord = {
  runId: string;
  at: string;
  sonarVersion: string;
  suite: string;
  suiteVersion: string;
  model: string | null;
  turns: number;
  dimensions: Record<ContextActivationDimension, number>;
  score: number;
  metrics: ContextActivationMetrics;
  notes: string;
};

const DIMENSION_WEIGHTS: Record<ContextActivationDimension, number> = {
  contextAvailability: 0.16,
  retrievalRecall: 0.18,
  retrievalPrecision: 0.12,
  curationSelectivity: 0.10,
  tokenEfficiency: 0.14,
  cacheEffectiveness: 0.10,
  retrievalLatency: 0.08,
  curatorLatency: 0.05,
  contextAttachLatency: 0.07,
};

export function scoreContextActivationRun(record: SonarRunRecord): ContextActivationScoreRecord {
  const metrics = collectContextActivationMetrics(record);
  if (metrics.tracedTurns === 0) {
    throw new Error(
      `Run ${record.runId.slice(0, 8)} has no serverTrace evidence. Re-run a voice or scene suite with trace capture enabled.`,
    );
  }

  const dimensions = computeContextActivationDimensions(metrics);
  const score = computeContextActivationScore(dimensions);

  return {
    runId: record.runId,
    at: new Date().toISOString(),
    sonarVersion: record.sonarVersion,
    suite: record.suite.name,
    suiteVersion: record.suite.version,
    model: record.observed.models[0] ?? record.config.model,
    turns: record.turns.length,
    dimensions,
    score,
    metrics,
    notes: contextActivationNotes(dimensions, metrics),
  };
}

export function loadContextActivationScores(repoRoot: string): ContextActivationScoreRecord[] {
  const file = path.join(repoRoot, CONTEXT_ACTIVATION_SCORES_PATH);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as ContextActivationScoreRecord;
      if (!parsed.runId || !parsed.suite || !parsed.dimensions || !parsed.metrics) {
        throw new Error(`${CONTEXT_ACTIVATION_SCORES_PATH}:${index + 1} is not a valid Context Activation score row`);
      }
      return parsed;
    });
}

export function upsertContextActivationScore(repoRoot: string, score: ContextActivationScoreRecord): string {
  const file = path.join(repoRoot, CONTEXT_ACTIVATION_SCORES_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows = loadContextActivationScores(repoRoot).filter((row) => row.runId !== score.runId);
  rows.push(score);
  rows.sort((a, b) => a.at.localeCompare(b.at));
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return file;
}

export function computeContextActivationScore(dimensions: Record<ContextActivationDimension, number>): number {
  return round1(CONTEXT_ACTIVATION_DIMENSIONS.reduce(
    (acc, dimension) => acc + dimensions[dimension] * DIMENSION_WEIGHTS[dimension],
    0,
  ));
}

export function collectContextActivationMetrics(record: SonarRunRecord): ContextActivationMetrics {
  const suite = SUITES[record.suite.name];
  const expectations = suite?.contextActivation?.turns ?? [];
  const validTurns = record.turns.filter((turn) => !turn.flags.error && !turn.flags.sttEmpty);
  const retrievalMs: number[] = [];
  const curatorMs: number[] = [];
  const contextAttachMs: number[] = [];
  const semanticHits: number[] = [];
  const selectedPages: number[] = [];
  const wikiPromptChars: number[] = [];
  const budgetUse: number[] = [];
  const selectedPageSlugs = new Set<string>();
  const expectedPageSlugs = new Set<string>();
  const pageRecalls: number[] = [];
  const pagePrecisions: number[] = [];
  let tracedTurns = 0;
  let contextTurns = 0;
  let cacheHits = 0;
  let staleCacheMisses = 0;
  let retrievalSkippedTurns = 0;
  let retrievalTurns = 0;
  let cacheEligibleTurns = 0;
  let labeledTurns = 0;
  let forbiddenPageHits = 0;

  for (const turn of validTurns) {
    if (!turn.serverTrace) continue;
    tracedTurns += 1;
    const retrievalDone = eventByName(turn, "server.retrieval.done");
    const curatorDone = eventByName(turn, "server.curator.done");
    const contextAttached = eventByName(turn, "server.context.attached");
    const staleCacheMiss = eventByName(turn, "server.context.cache.miss_stale");

    pushNumber(retrievalMs, turn.spans["server.retrieval"]);
    pushNumber(curatorMs, turn.spans["server.curator"]);
    pushNumber(contextAttachMs, turn.spans["server.context"]);

    if (retrievalDone) {
      retrievalTurns += 1;
      pushNumber(semanticHits, metaNumber(retrievalDone, "hits"));
    }

    if (curatorDone) {
      pushNumber(selectedPages, metaNumber(curatorDone, "selectedPages"));
      const tokensUsed = metaNumber(curatorDone, "tokensUsed");
      const tokensBudget = metaNumber(curatorDone, "tokensBudget");
      if (isNumber(tokensUsed) && isNumber(tokensBudget) && tokensBudget > 0) {
        budgetUse.push(tokensUsed / tokensBudget);
      }
    }

    if (contextAttached) {
      const attachedSelectedPages = metaNumber(contextAttached, "selectedPages");
      const attachedSemanticHits = metaNumber(contextAttached, "semanticHits");
      const attachedWikiChars = metaNumber(contextAttached, "wikiPromptChunkChars");
      const attachedPageSlugs = metaStringArray(contextAttached, "selectedPageSlugs");
      const contextCacheHit = metaBoolean(contextAttached, "contextCacheHit") ?? turn.flags.contextCacheHit;
      const retrievalSkipped = metaBoolean(contextAttached, "retrievalSkipped") ?? turn.flags.retrievalSkipped;

      pushNumber(selectedPages, attachedSelectedPages);
      pushNumber(semanticHits, attachedSemanticHits);
      pushNumber(wikiPromptChars, attachedWikiChars);
      for (const slug of attachedPageSlugs) selectedPageSlugs.add(slug);

      if (contextCacheHit) cacheHits += 1;
      if (staleCacheMiss) staleCacheMisses += 1;
      if (retrievalSkipped) retrievalSkippedTurns += 1;
      if (record.suite.mode !== "context" && turn.turnIndex > 0 && !staleCacheMiss) {
        cacheEligibleTurns += 1;
      }
      if (
        contextCacheHit ||
        positive(attachedWikiChars) ||
        positive(attachedSelectedPages) ||
        positive(attachedSemanticHits)
      ) {
        contextTurns += 1;
      }

      const expectation = expectations[turn.turnIndex] ?? null;
      if (expectation?.expectedPageSlugs?.length) {
        labeledTurns += 1;
        const gold = normalizeSlugSet(expectation.expectedPageSlugs);
        const selected = normalizeSlugSet(attachedPageSlugs);
        for (const slug of gold) expectedPageSlugs.add(slug);
        const matched = [...gold].filter((slug) => selected.has(slug)).length;
        pageRecalls.push(gold.size > 0 ? matched / gold.size : 1);
        pagePrecisions.push(selected.size > 0 ? matched / selected.size : 0);
      }
      if (expectation?.mustNotInjectPageSlugs?.length) {
        const selected = normalizeSlugSet(attachedPageSlugs);
        const forbidden = normalizeSlugSet(expectation.mustNotInjectPageSlugs);
        forbiddenPageHits += [...forbidden].filter((slug) => selected.has(slug)).length;
      }
    }
  }

  return {
    turns: validTurns.length,
    tracedTurns,
    contextTurns,
    retrievalTurns,
    cacheEligibleTurns,
    cacheHits,
    staleCacheMisses,
    retrievalSkippedTurns,
    labeledTurns,
    pageRecall: averageRatioOrNull(pageRecalls),
    pagePrecision: averageRatioOrNull(pagePrecisions),
    forbiddenPageHits,
    selectedPageSlugs: [...selectedPageSlugs].sort(),
    expectedPageSlugs: [...expectedPageSlugs].sort(),
    avgSemanticHits: averageOrNull(semanticHits),
    avgSelectedPages: averageOrNull(selectedPages),
    avgWikiPromptChars: averageOrNull(wikiPromptChars),
    avgTokenBudgetUse: averageOrNull(budgetUse),
    retrievalMs: aggregate(retrievalMs),
    curatorMs: aggregate(curatorMs),
    contextAttachMs: aggregate(contextAttachMs),
  };
}

function computeContextActivationDimensions(metrics: ContextActivationMetrics): Record<ContextActivationDimension, number> {
  const availability = metrics.tracedTurns > 0 ? pct(metrics.contextTurns, metrics.tracedTurns) : 0;
  const selected = metrics.avgSelectedPages ?? 0;
  const hits = metrics.avgSemanticHits ?? 0;
  const budgetUse = metrics.avgTokenBudgetUse;
  const recall = metrics.pageRecall !== null
    ? clamp(metrics.pageRecall * 100)
    : retrievalProxyScore(hits, selected, metrics.contextTurns);
  const precisionBase = metrics.pagePrecision !== null
    ? clamp(metrics.pagePrecision * 100)
    : precisionProxyScore(selected, metrics.contextTurns);
  const precision = clamp(precisionBase - metrics.forbiddenPageHits * 15);
  return {
    contextAvailability: clamp(availability),
    retrievalRecall: recall,
    retrievalPrecision: precision,
    curationSelectivity: selectivityScore(selected),
    tokenEfficiency: tokenBudgetScore(budgetUse),
    cacheEffectiveness: metrics.cacheEligibleTurns > 0 ? clamp(pct(metrics.cacheHits, metrics.cacheEligibleTurns)) : 100,
    retrievalLatency: metrics.retrievalMs ? latencyScore(metrics.retrievalMs.p50, 500, 3_000) : (metrics.retrievalTurns === 0 ? 100 : 0),
    curatorLatency: metrics.curatorMs ? latencyScore(metrics.curatorMs.p50, 500, 3_000) : (metrics.retrievalTurns === 0 ? 100 : 0),
    contextAttachLatency: metrics.contextAttachMs ? latencyScore(metrics.contextAttachMs.p50, 250, 2_500) : 0,
  };
}

function retrievalProxyScore(avgHits: number, avgSelectedPages: number, contextTurns: number): number {
  if (contextTurns <= 0) return 0;
  if (avgSelectedPages >= 1 && avgHits >= 1) return 100;
  if (avgSelectedPages >= 1) return 75;
  if (avgHits >= 1) return 55;
  return 25;
}

function precisionProxyScore(avgSelectedPages: number, contextTurns: number): number {
  if (contextTurns <= 0) return 0;
  return selectivityScore(avgSelectedPages);
}

function selectivityScore(avgSelectedPages: number): number {
  if (avgSelectedPages <= 0) return 0;
  if (avgSelectedPages <= 5) return 100;
  if (avgSelectedPages <= 8) return 80;
  if (avgSelectedPages <= 12) return 50;
  return 20;
}

function tokenBudgetScore(avgBudgetUse: number | null): number {
  if (avgBudgetUse === null) return 50;
  if (avgBudgetUse <= 0) return 0;
  if (avgBudgetUse <= 0.9) return 100;
  if (avgBudgetUse <= 1.1) return 80;
  if (avgBudgetUse <= 1.5) return 55;
  if (avgBudgetUse <= 2) return 25;
  return 0;
}

function contextActivationNotes(
  dimensions: Record<ContextActivationDimension, number>,
  metrics: ContextActivationMetrics,
): string {
  const issues: string[] = [];
  if (dimensions.tokenEfficiency < 60 && metrics.avgTokenBudgetUse !== null) {
    issues.push(`curator averages ${(metrics.avgTokenBudgetUse * 100).toFixed(0)}% of token budget`);
  }
  if (dimensions.cacheEffectiveness < 80) {
    issues.push(`${metrics.cacheHits}/${metrics.cacheEligibleTurns} cache-eligible turns hit cache`);
  }
  if (dimensions.contextAvailability < 95) {
    issues.push(`${metrics.contextTurns}/${metrics.tracedTurns} traced turns had attached context`);
  }
  if (metrics.labeledTurns > 0 && dimensions.retrievalRecall < 80) {
    issues.push(`gold page recall ${(metrics.pageRecall ?? 0).toFixed(1)} across ${metrics.labeledTurns} labeled turns`);
  }
  if (metrics.labeledTurns > 0 && dimensions.retrievalPrecision < 70) {
    issues.push(`gold page precision ${(metrics.pagePrecision ?? 0).toFixed(1)} with ${metrics.forbiddenPageHits} forbidden page hit(s)`);
  }
  if (dimensions.retrievalLatency < 70 && metrics.retrievalMs) {
    issues.push(`retrieval p50 ${metrics.retrievalMs.p50}ms`);
  }
  if (issues.length === 0) {
    return metrics.labeledTurns > 0
      ? "Context was attached consistently with healthy recall, precision, and cache behavior."
      : "Context was attached consistently with healthy cache behavior; run context-activation-baseline for gold recall and precision.";
  }
  return `Context Activation flags: ${issues.join("; ")}.`;
}

function eventByName(turn: SonarTurnRecord, name: string): TraceContractEvent | null {
  return turn.serverTrace?.events.find((event) => event.name === name) ?? null;
}

function metaNumber(event: TraceContractEvent, key: string): number | null {
  return asNumber(event.meta?.[key]) ?? null;
}

function metaBoolean(event: TraceContractEvent, key: string): boolean | null {
  const value = event.meta?.[key];
  return typeof value === "boolean" ? value : null;
}

function metaStringArray(event: TraceContractEvent, key: string): string[] {
  const value = event.meta?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function pushNumber(target: number[], value: unknown): void {
  const parsed = asNumber(value);
  if (parsed !== undefined && parsed >= 0) target.push(parsed);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function averageOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((acc, value) => acc + value, 0) / values.length);
}

function averageRatioOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((acc, value) => acc + value, 0) / values.length) * 1000) / 1000;
}

function latencyScore(ms: number, goodMs: number, badMs: number): number {
  if (ms <= goodMs) return 100;
  if (ms >= badMs) return 0;
  return round1(100 - ((ms - goodMs) / (badMs - goodMs)) * 100);
}

function pct(n: number, d: number): number {
  return d > 0 ? (n / d) * 100 : 0;
}

function positive(value: unknown): boolean {
  const parsed = asNumber(value);
  return parsed !== undefined && parsed > 0;
}

function normalizeSlugSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, round1(value)));
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
