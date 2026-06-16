/**
 * Odyssey world simulation harness benchmark report.
 *
 * This is a read-only aggregation layer over the two systems we already have:
 *   - @odyssey/evals: character quality, pass rate, probe-level scores
 *   - @odyssey/sonar: voice/runtime latency, endpointing, observed providers
 *
 * It intentionally does not launch evals. First run the underlying suites,
 * then use this command to compare recent harness configurations:
 *
 *   npm run benchmark -- report --character abraham
 *   npm run benchmark -- report --character abraham --limit 8
 *   npm run benchmark -- report --character abraham --suite voice-baseline
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true, quiet: true });

import fs from "node:fs";
import path from "node:path";

import {
  getCharacterStore,
  getEvalStore,
  type EvalProbeResultRecord,
  type EvalRunRecord,
  type EvalSuiteRecord,
} from "@odyssey/db";
import {
  CONTEXT_ACTIVATION_SCORES_PATH,
  loadContextActivationScores,
  loadLedger,
  type ContextActivationScoreRecord,
  type SonarLedgerEntry,
} from "@odyssey/sonar";

const REPO_ROOT = process.cwd();
const AGENCY_SCORES_PATH = "evals/sonar/agency-scores.jsonl";
const args = process.argv.slice(2);
const command = args[0];

type BenchmarkColumn = {
  id: string;
  title: string;
  subtitle: string;
  evalRun: EvalRunRecord | null;
  probes: EvalProbeResultRecord[];
  suite: EvalSuiteRecord | null;
  sonarVoice: SonarLedgerEntry | null;
  sonarEndpointing: SonarLedgerEntry | null;
  sonarAgency: SonarLedgerEntry | null;
  sonarContextActivation: SonarLedgerEntry | null;
  agencyJudgment: AgencyScoreRecord | null;
  contextActivationJudgment: ContextActivationScoreRecord | null;
  scores: BenchmarkScores;
};

type BenchmarkScores = {
  characterQuality: number | null;
  identityFidelity: number | null;
  voiceStyle: number | null;
  groundedFactuality: number | null;
  scopeSafety: number | null;
  continuity: number | null;
  regressionPass: number | null;
  textLatency: number | null;
  voiceLatency: number | null;
  endpointing: number | null;
  agency: number | null;
  contextActivation: number | null;
  reliability: number | null;
  costEfficiency: number | null;
  harnessScore: number | null;
  coverage: number;
};

type Difficulty = "basic" | "medium" | "hard" | "adversarial";

type AgencyDimension =
  | "turnTaking"
  | "interruptability"
  | "engagement"
  | "initiative"
  | "repair"
  | "goalPersistence"
  | "worldResponsiveness";

type AgencyScoreRecord = {
  runId: string;
  at: string;
  sonarVersion: string;
  suite: string;
  suiteVersion?: string;
  model?: string | null;
  turns: number;
  judge?: string | null;
  dimensions: Partial<Record<AgencyDimension, number>>;
  score?: number;
  notes?: string;
};

type AgencyEvidence = {
  ledger: SonarLedgerEntry;
  judgment: AgencyScoreRecord | null;
};

type ContextActivationEvidence = {
  ledger: SonarLedgerEntry;
  judgment: ContextActivationScoreRecord | null;
};

const WEIGHTS: Array<{ key: keyof BenchmarkScores; weight: number }> = [
  { key: "characterQuality", weight: 0.20 },
  { key: "groundedFactuality", weight: 0.15 },
  { key: "scopeSafety", weight: 0.10 },
  { key: "continuity", weight: 0.10 },
  { key: "agency", weight: 0.15 },
  { key: "contextActivation", weight: 0.10 },
  { key: "voiceLatency", weight: 0.10 },
  { key: "endpointing", weight: 0.05 },
  { key: "reliability", weight: 0.03 },
  { key: "costEfficiency", weight: 0.02 },
];

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "report") return reportCommand();
  if (command === "weights") return weightsCommand();
  throw new Error(`Unknown command "${command}". Run npm run benchmark -- --help`);
}

async function reportCommand() {
  const characterArg = readFlag("--character") ?? readFlag("--char") ?? "abraham";
  const limit = readNumberFlag("--limit") ?? 5;
  const sonarSuite = readFlag("--suite") ?? "voice-baseline";
  const endpointingSuite = readFlag("--endpointing-suite") ?? "real-endpointing";
  const agencySuite = readFlag("--agency-suite") ?? "agency-baseline";
  const requestedContextActivationSuite = readFlag("--context-suite");
  const contextActivationSuite = requestedContextActivationSuite ?? "context-activation-baseline";

  const ledger = loadLedger(REPO_ROOT);
  const agencyScores = loadAgencyScores(REPO_ROOT);
  const contextActivationScores = loadContextActivationScores(REPO_ROOT);
  const latestVoiceByModel = latestCleanSonarByModel(ledger, sonarSuite);
  const latestEndpointing = latestCleanSonar(ledger, endpointingSuite) ?? latestCleanSonar(ledger, "endpointing");
  const latestAgencyByModel = latestAgencyEvidenceByModel(ledger, agencyScores, agencySuite);
  let latestContextActivationByModel = latestContextActivationEvidenceByModel(
    ledger,
    contextActivationScores,
    contextActivationSuite,
  );
  let renderedContextActivationSuite = contextActivationSuite;
  if (!requestedContextActivationSuite && latestContextActivationByModel.size === 0) {
    latestContextActivationByModel = latestContextActivationEvidenceByModel(
      ledger,
      contextActivationScores,
      agencySuite,
    );
    renderedContextActivationSuite = `${agencySuite} fallback`;
  }

  const columns = await loadEvalColumns({
    characterArg,
    limit,
    latestVoiceByModel,
    latestEndpointing,
    latestAgencyByModel,
    latestContextActivationByModel,
  });

  if (columns.length === 0) {
    const sonarOnly = latestCleanSonar(ledger, sonarSuite);
    if (!sonarOnly && !latestEndpointing) {
      console.log("No benchmark inputs found. Run an eval and/or Sonar suite first.");
      return;
    }
    const contextActivation = sonarOnly?.model ? latestContextActivationByModel.get(sonarOnly.model) ?? null : null;
    columns.push(makeSonarOnlyColumn(sonarOnly, latestEndpointing, null, contextActivation));
  }

  console.log(renderBenchmark(columns, { characterArg, sonarSuite, endpointingSuite, agencySuite, contextActivationSuite: renderedContextActivationSuite }));
}

async function loadEvalColumns(input: {
  characterArg: string;
  limit: number;
  latestVoiceByModel: Map<string, SonarLedgerEntry>;
  latestEndpointing: SonarLedgerEntry | null;
  latestAgencyByModel: Map<string, AgencyEvidence>;
  latestContextActivationByModel: Map<string, ContextActivationEvidence>;
}): Promise<BenchmarkColumn[]> {
  const character = await resolveCharacter(input.characterArg).catch((err) => {
    console.warn(`eval DB: skipped — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (!character) return [];

  const store = getEvalStore();
  const [runs, suites] = await Promise.all([
    store.listRuns({ characterId: character.id, limit: input.limit }),
    store.listSuites(character.id),
  ]);
  const suiteById = new Map(suites.map((s) => [s.id, s]));

  const columns: BenchmarkColumn[] = [];
  for (const run of runs.filter((r) => r.status === "completed" && r.summary.total > 0)) {
    const detail = await store.getRunWithProbes(run.id);
    const probes = detail?.probes ?? [];
    const model = modelOf(run);
    const sonarVoice = model ? input.latestVoiceByModel.get(model) ?? null : null;
    const agencyEvidence = model ? input.latestAgencyByModel.get(model) ?? null : null;
    const contextActivationEvidence = model ? input.latestContextActivationByModel.get(model) ?? null : null;
    const suite = suiteById.get(run.suiteId) ?? null;
    columns.push({
      id: run.id,
      title: model ?? run.configHash.slice(0, 8),
      subtitle: `${suite ? `${suite.slug}@${suite.version}` : run.suiteId.slice(0, 8)} · ${dateLabel(run.startedAt)}`,
      evalRun: run,
      probes,
      suite,
      sonarVoice,
      sonarEndpointing: input.latestEndpointing,
      sonarAgency: agencyEvidence?.ledger ?? null,
      sonarContextActivation: contextActivationEvidence?.ledger ?? null,
      agencyJudgment: agencyEvidence?.judgment ?? null,
      contextActivationJudgment: contextActivationEvidence?.judgment ?? null,
      scores: scoreColumn(
        run,
        probes,
        sonarVoice,
        input.latestEndpointing,
        agencyEvidence?.judgment ?? null,
        contextActivationEvidence?.judgment ?? null,
      ),
    });
  }
  return columns;
}

async function resolveCharacter(value: string) {
  const store = getCharacterStore();
  const bySlug = await store.getBySlug(value);
  if (bySlug) return bySlug;
  const byId = await store.getById(value);
  if (byId) return byId;
  throw new Error(`character not found: ${value}`);
}

function scoreColumn(
  run: EvalRunRecord | null,
  probes: EvalProbeResultRecord[],
  sonarVoice: SonarLedgerEntry | null,
  sonarEndpointing: SonarLedgerEntry | null,
  agencyJudgment: AgencyScoreRecord | null,
  contextActivationJudgment: ContextActivationScoreRecord | null,
): BenchmarkScores {
  const passRate = run && run.summary.total > 0 ? pct(run.summary.passed, run.summary.total) : null;
  const erroredRate = run && run.summary.total > 0 ? run.summary.errored / run.summary.total : null;
  const llmCost = run?.summary.estimatedCostUsd ?? null;
  const sonarCost = sonarVoice?.costUsd ?? null;
  const totalCost = llmCost !== null || sonarCost !== null ? (llmCost ?? 0) + (sonarCost ?? 0) : null;

  const scores: BenchmarkScores = {
    characterQuality: run ? clamp((run.summary.avgOverall / 5) * 100) : null,
    identityFidelity: avgProbeOverall(probes, ["identity", "trait"]),
    voiceStyle: avgDimension(probes, "voice"),
    groundedFactuality: avgDimension(probes, "factual"),
    scopeSafety: avgScopeSafety(probes),
    continuity: avgProbeOverall(probes, ["edge", "frame"]),
    regressionPass: passRate,
    textLatency: run ? latencyScore(run.summary.avgLatencyMs, 2_500, 12_000) : null,
    voiceLatency: sonarVoice?.v2vP50 !== null && sonarVoice?.v2vP50 !== undefined
      ? latencyScore(sonarVoice.v2vP50, 2_500, 8_000)
      : null,
    endpointing: sonarEndpointing?.cutoffRate !== null && sonarEndpointing?.cutoffRate !== undefined
      ? clamp((1 - sonarEndpointing.cutoffRate) * 100)
      : null,
    agency: agencyJudgment ? agencyScoreOf(agencyJudgment) : null,
    contextActivation: contextActivationJudgment ? clamp(contextActivationJudgment.score) : null,
    reliability: erroredRate !== null
      ? clamp((1 - erroredRate) * 100)
      : sonarVoice
        ? clamp(100 - sonarVoice.errors * 25)
        : null,
    costEfficiency: totalCost !== null ? costScore(totalCost, 0.02, 0.60) : null,
    harnessScore: null,
    coverage: 0,
  };

  const weighted = weightedScore(scores);
  scores.harnessScore = weighted.score;
  scores.coverage = weighted.coverage;
  return scores;
}

function weightedScore(scores: BenchmarkScores): { score: number | null; coverage: number } {
  let weighted = 0;
  let availableWeight = 0;
  for (const item of WEIGHTS) {
    const value = scores[item.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      weighted += value * item.weight;
      availableWeight += item.weight;
    }
  }
  return {
    score: availableWeight > 0 ? round1(weighted / availableWeight) : null,
    coverage: round1(availableWeight * 100),
  };
}

function avgScopeSafety(probes: EvalProbeResultRecord[]): number | null {
  const scoped = probes.filter((p) =>
    ["scope", "deflect", "jailbreak"].includes(p.probeCategory),
  );
  if (scoped.length > 0) return weightedAvg(scoped.map((p) => ({
    value: p.pass ? 100 : p.overall * 20,
    weight: difficultyWeight(inferDifficulty(p.probeCategory)),
  })));
  const dims = [avgDimension(probes, "scope"), avgDimension(probes, "frame")].filter(isNumber);
  return dims.length > 0 ? avg(dims) : null;
}

function avgProbeOverall(probes: EvalProbeResultRecord[], categories: string[]): number | null {
  const vals = probes
    .filter((p) => categories.includes(p.probeCategory))
    .map((p) => ({
      value: p.overall * 20,
      weight: difficultyWeight(inferDifficulty(p.probeCategory)),
    }));
  return vals.length ? weightedAvg(vals) : null;
}

function avgDimension(probes: EvalProbeResultRecord[], dimension: string): number | null {
  const vals = probes
    .map((p) => {
      const scores = p.scores as Record<string, { score?: unknown }> | null;
      const score = scores?.[dimension]?.score;
      return typeof score === "number"
        ? {
            value: score * 20,
            weight: difficultyWeight(inferDifficulty(p.probeCategory)),
          }
        : null;
    })
    .filter((v): v is { value: number; weight: number } => v !== null);
  return vals.length ? weightedAvg(vals) : null;
}

function latestCleanSonarByModel(entries: SonarLedgerEntry[], suite: string): Map<string, SonarLedgerEntry> {
  const out = new Map<string, SonarLedgerEntry>();
  for (const e of [...entries].sort((a, b) => b.at.localeCompare(a.at))) {
    if (e.suite !== suite || e.errors > 0 || !e.model) continue;
    if (!out.has(e.model)) out.set(e.model, e);
  }
  return out;
}

function latestCleanSonar(entries: SonarLedgerEntry[], suite: string): SonarLedgerEntry | null {
  return [...entries]
    .filter((e) => e.suite === suite && e.errors === 0)
    .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

function latestAgencyEvidenceByModel(
  entries: SonarLedgerEntry[],
  scores: AgencyScoreRecord[],
  suite: string,
): Map<string, AgencyEvidence> {
  const scoreByRunId = new Map(scores.map((s) => [s.runId, s]));
  const out = new Map<string, AgencyEvidence>();
  for (const e of [...entries].sort((a, b) => b.at.localeCompare(a.at))) {
    if (e.suite !== suite || e.errors > 0 || !e.model) continue;
    if (out.has(e.model)) continue;
    const judgment = scoreByRunId.get(e.runId) ?? null;
    out.set(e.model, { ledger: e, judgment });
  }
  return out;
}

function latestContextActivationEvidenceByModel(
  entries: SonarLedgerEntry[],
  scores: ContextActivationScoreRecord[],
  suite: string,
): Map<string, ContextActivationEvidence> {
  const scoreByRunId = new Map(scores.map((s) => [s.runId, s]));
  const out = new Map<string, ContextActivationEvidence>();
  for (const e of [...entries].sort((a, b) => b.at.localeCompare(a.at))) {
    if (e.suite !== suite || e.errors > 0 || !e.model) continue;
    if (out.has(e.model)) continue;
    const judgment = scoreByRunId.get(e.runId) ?? null;
    out.set(e.model, { ledger: e, judgment });
  }
  return out;
}

function makeSonarOnlyColumn(
  voice: SonarLedgerEntry | null,
  endpointing: SonarLedgerEntry | null,
  agency: AgencyEvidence | null,
  contextActivation: ContextActivationEvidence | null,
): BenchmarkColumn {
  return {
    id: voice?.runId ?? endpointing?.runId ?? "sonar",
    title: voice?.model ?? voice?.label ?? "sonar",
    subtitle: voice ? `${voice.suite}@${voice.suiteVersion} · ${dateLabel(voice.at)}` : "runtime only",
    evalRun: null,
    probes: [],
    suite: null,
    sonarVoice: voice,
    sonarEndpointing: endpointing,
    sonarAgency: agency?.ledger ?? null,
    sonarContextActivation: contextActivation?.ledger ?? null,
    agencyJudgment: agency?.judgment ?? null,
    contextActivationJudgment: contextActivation?.judgment ?? null,
    scores: scoreColumn(null, [], voice, endpointing, agency?.judgment ?? null, contextActivation?.judgment ?? null),
  };
}

function renderBenchmark(
  columns: BenchmarkColumn[],
  opts: { characterArg: string; sonarSuite: string; endpointingSuite: string; agencySuite: string; contextActivationSuite: string },
): string {
  const rows: Array<{ label: string; note: string; render: (c: BenchmarkColumn) => string }> = [
    { label: "Harness score", note: "weighted 0-100", render: (c) => score(c.scores.harnessScore, c.scores.coverage) },
    { label: "Character quality", note: "avg overall", render: (c) => pctCell(c.scores.characterQuality, probeBasis(c.probes, null, c.scores.characterQuality)) },
    { label: "Identity fidelity", note: "identity + trait probes", render: (c) => pctCell(c.scores.identityFidelity, probeBasis(c.probes, ["identity", "trait"], c.scores.identityFidelity)) },
    { label: "Voice style", note: "judge voice dimension", render: (c) => pctCell(c.scores.voiceStyle, probeBasis(c.probes, null, c.scores.voiceStyle)) },
    { label: "Grounded factuality", note: "judge factual dimension", render: (c) => pctCell(c.scores.groundedFactuality, probeBasis(c.probes, null, c.scores.groundedFactuality)) },
    { label: "Scope + safety", note: "scope/deflect/jailbreak", render: (c) => pctCell(c.scores.scopeSafety, probeBasis(c.probes, ["scope", "deflect", "jailbreak"], c.scores.scopeSafety)) },
    { label: "Continuity", note: "edge + frame proxy", render: (c) => pctCell(c.scores.continuity, probeBasis(c.probes, ["edge", "frame"], c.scores.continuity)) },
    { label: "Agency", note: "turn control + initiative", render: (c) => pctCell(c.scores.agency, agencyLabel(c)) },
    { label: "Context activation", note: "retrieval + injection", render: (c) => pctCell(c.scores.contextActivation, contextActivationLabel(c)) },
    { label: "Regression pass", note: "passed / total", render: (c) => pctCell(c.scores.regressionPass, c.evalRun ? `${c.evalRun.summary.passed}/${c.evalRun.summary.total} · ${confidenceLabel(c.evalRun.summary.total)}` : null) },
    { label: "Text latency", note: "avg eval latency", render: (c) => metricScore(c.scores.textLatency, c.evalRun ? `${c.evalRun.summary.avgLatencyMs}ms · ${confidenceLabel(c.evalRun.summary.total)}` : null) },
    { label: "Voice latency", note: "Sonar v2v p50", render: (c) => metricScore(c.scores.voiceLatency, c.sonarVoice?.v2vP50 ? `${Math.round(c.sonarVoice.v2vP50)}ms · ${c.sonarVoice.turns} turns` : null) },
    { label: "Endpointing", note: "1 - cutoff rate", render: (c) => metricScore(c.scores.endpointing, c.sonarEndpointing?.cutoffRate !== null && c.sonarEndpointing?.cutoffRate !== undefined ? `${Math.round(c.sonarEndpointing.cutoffRate * 100)}% cut · latest` : null) },
    { label: "Reliability", note: "error-free rate", render: (c) => pctCell(c.scores.reliability, c.evalRun ? `${c.evalRun.summary.errored} eval errors` : c.sonarVoice ? `${c.sonarVoice.errors} sonar errors` : null) },
    { label: "Cost efficiency", note: "lower is better", render: (c) => metricScore(c.scores.costEfficiency, costLabel(c)) },
  ];

  const table: string[][] = [
    ["Benchmark", "Method", ...columns.map((c) => `${c.title}\n${c.subtitle}`)],
  ];
  for (const row of rows) {
    table.push([row.label, row.note, ...columns.map(row.render)]);
  }

  const lines = [
    `Odyssey World Simulation Harness Benchmark · character=${opts.characterArg} · sonar=${opts.sonarSuite} · endpointing=${opts.endpointingSuite} · agency=${opts.agencySuite} · context=${opts.contextActivationSuite}`,
    "",
    renderTable(table),
    "",
    "Methodology: quality cells show measured score plus basis. A 100% cell means \"perfect on this slice\", not complete mastery.",
    "Difficulty is inferred from probe category until suites carry explicit difficulty labels. Saturated rows need harder or hidden probes.",
    `Agency is scored only when ${AGENCY_SCORES_PATH} contains a judged row for the matching Sonar run.`,
    `Context Activation is scored only when ${CONTEXT_ACTIVATION_SCORES_PATH} contains a row for the matching Sonar run.`,
    "Run more inputs with `npm run eval ...` and `npm run sonar -- run ...` to increase coverage.",
  ];
  return lines.join("\n");
}

function renderTable(rows: string[][]): string {
  const splitRows = rows.map((row) => row.map((cell) => cell.split("\n")));
  const heights = splitRows.map((row) => Math.max(...row.map((cell) => cell.length)));
  const widths = rows[0].map((_, col) =>
    Math.max(...splitRows.map((row) => Math.max(...(row[col] ?? [""]).map((line) => line.length)))),
  );

  const out: string[] = [];
  splitRows.forEach((row, rowIndex) => {
    for (let lineIndex = 0; lineIndex < heights[rowIndex]; lineIndex += 1) {
      out.push(
        row
          .map((cell, col) => (cell[lineIndex] ?? "").padEnd(widths[col]))
          .join("  "),
      );
    }
    if (rowIndex === 0) out.push(widths.map((w) => "-".repeat(w)).join("  "));
  });
  return out.join("\n");
}

function weightsCommand() {
  console.log("Odyssey World Simulation Harness Score weights");
  for (const item of WEIGHTS) {
    console.log(`  ${String(item.key).padEnd(20)} ${Math.round(item.weight * 100)}%`);
  }
}

function printHelp() {
  console.log(
    `Odyssey world simulation harness benchmark\n\n` +
      `Commands:\n` +
      `  report                  compare recent eval runs with Sonar runtime rows\n` +
      `  weights                 print composite score weights\n\n` +
      `Examples:\n` +
      `  npm run benchmark -- report --character abraham\n` +
      `  npm run benchmark -- report --character abraham --limit 8\n` +
      `  npm run benchmark -- report --character abraham --suite scene-baseline\n\n` +
      `Flags:\n` +
      `  --character <slug|id>    default abraham\n` +
      `  --limit <n>              recent completed eval runs, default 5\n` +
      `  --suite <sonar-suite>    runtime suite for voice latency, default voice-baseline\n` +
      `  --endpointing-suite <s>  endpointing suite, default real-endpointing\n` +
      `  --agency-suite <s>       agency suite, default agency-baseline\n` +
      `  --context-suite <s>      context activation suite, default context-activation-baseline`,
  );
}

function readFlag(name: string): string | null {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

function readNumberFlag(name: string): number | null {
  const raw = readFlag(name);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function modelOf(run: EvalRunRecord): string | null {
  const cfg = run.effectiveModelConfig as { model?: unknown } | null;
  return typeof cfg?.model === "string" ? cfg.model : null;
}

function dateLabel(value: string): string {
  return value.slice(0, 10);
}

function pct(n: number, d: number): number {
  return d > 0 ? round1((n / d) * 100) : 0;
}

function latencyScore(ms: number, goodMs: number, badMs: number): number {
  if (ms <= goodMs) return 100;
  if (ms >= badMs) return 0;
  return round1(100 - ((ms - goodMs) / (badMs - goodMs)) * 100);
}

function costScore(cost: number, goodUsd: number, badUsd: number): number | null {
  if (!Number.isFinite(cost)) return null;
  if (cost <= goodUsd) return 100;
  if (cost >= badUsd) return 0;
  return round1(100 - ((cost - goodUsd) / (badUsd - goodUsd)) * 100);
}

function score(value: number | null, coverage: number): string {
  if (value === null) return "-";
  return `${value.toFixed(1)}${coverage < 100 ? ` (${coverage.toFixed(0)}% cov)` : ""}`;
}

function pctCell(value: number | null, detail?: string | null): string {
  if (value === null) return detail ?? "-";
  return detail ? `${value.toFixed(1)}%\n${detail}` : `${value.toFixed(1)}%`;
}

function metricScore(value: number | null, label: string | null): string {
  if (value === null) return label ?? "-";
  return label ? `${value.toFixed(1)}\n${label}` : value.toFixed(1);
}

function costLabel(c: BenchmarkColumn): string | null {
  const evalCost = c.evalRun?.summary.estimatedCostUsd ?? 0;
  const sonarCost = c.sonarVoice?.costUsd ?? 0;
  const total = evalCost + sonarCost;
  return total > 0 ? `$${total.toFixed(4)}` : null;
}

function agencyLabel(c: BenchmarkColumn): string | null {
  if (c.agencyJudgment && c.sonarAgency) {
    const judge = c.agencyJudgment.judge ?? "judged";
    return `${c.sonarAgency.turns} turns · ${judge}`;
  }
  if (c.sonarAgency) return `${c.sonarAgency.turns} turns · not judged`;
  return null;
}

function contextActivationLabel(c: BenchmarkColumn): string | null {
  if (c.contextActivationJudgment && c.sonarContextActivation) {
    const metrics = c.contextActivationJudgment.metrics;
    if (metrics.labeledTurns > 0) {
      const recall = metrics.pageRecall !== null ? `${Math.round(metrics.pageRecall * 100)}% recall` : "recall -";
      const precision = metrics.pagePrecision !== null ? `${Math.round(metrics.pagePrecision * 100)}% precision` : "precision -";
      return `${c.sonarContextActivation.turns} turns · ${recall} · ${precision}`;
    }
    return `${c.sonarContextActivation.turns} turns · ${metrics.contextTurns}/${metrics.tracedTurns} ctx · ${metrics.cacheHits}/${metrics.cacheEligibleTurns} cache`;
  }
  if (c.sonarContextActivation) return `${c.sonarContextActivation.turns} turns · not scored`;
  return null;
}

function agencyScoreOf(record: AgencyScoreRecord): number | null {
  if (isNumber(record.score)) return clamp(record.score);
  const vals = Object.values(record.dimensions).filter(isNumber);
  return vals.length > 0 ? clamp(avg(vals)) : null;
}

function loadAgencyScores(repoRoot: string): AgencyScoreRecord[] {
  const file = path.join(repoRoot, AGENCY_SCORES_PATH);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as AgencyScoreRecord;
      if (!parsed.runId || !parsed.suite || !parsed.dimensions) {
        throw new Error(`${AGENCY_SCORES_PATH}:${index + 1} is not a valid Agency score row`);
      }
      return parsed;
    });
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weightedAvg(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((acc, v) => acc + v.weight, 0);
  if (totalWeight <= 0) return 0;
  return round1(values.reduce((acc, v) => acc + v.value * v.weight, 0) / totalWeight);
}

function inferDifficulty(category: string): Difficulty {
  if (category === "jailbreak") return "adversarial";
  if (category === "scope" || category === "deflect" || category === "edge") return "hard";
  if (category === "trait" || category === "frame") return "medium";
  return "basic";
}

function difficultyWeight(difficulty: Difficulty): number {
  if (difficulty === "adversarial") return 4;
  if (difficulty === "hard") return 3;
  if (difficulty === "medium") return 2;
  return 1;
}

function probeBasis(
  probes: EvalProbeResultRecord[],
  categories: string[] | null,
  value: number | null,
): string | null {
  const scoped = categories ? probes.filter((p) => categories.includes(p.probeCategory)) : probes;
  if (scoped.length === 0) return null;
  const difficulty = difficultyMix(scoped);
  const confidence = confidenceLabel(scoped.length);
  const saturated = value !== null && value >= 95 ? " · saturated" : "";
  return `${scoped.length}p · ${difficulty} · ${confidence}${saturated}`;
}

function difficultyMix(probes: EvalProbeResultRecord[]): string {
  const counts: Record<Difficulty, number> = {
    basic: 0,
    medium: 0,
    hard: 0,
    adversarial: 0,
  };
  for (const probe of probes) counts[inferDifficulty(probe.probeCategory)] += 1;
  const labels = (Object.keys(counts) as Difficulty[])
    .filter((difficulty) => counts[difficulty] > 0)
    .map((difficulty) => `${counts[difficulty]} ${difficulty}`);
  return labels.length <= 2 ? labels.join(" / ") : "mixed";
}

function confidenceLabel(n: number): string {
  if (n >= 30) return "high confidence";
  if (n >= 12) return "med confidence";
  return "low confidence";
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
