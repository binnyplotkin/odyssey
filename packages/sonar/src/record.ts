/**
 * Run-record persistence and the progression report.
 *
 * Two storage tiers:
 *   - Full run records (every turn, every raw trace) → `.sonar/runs/`,
 *     gitignored like `.evals/` — large, machine-local.
 *   - Ledger (`evals/sonar/ledger.jsonl`) — one compact JSON line per run,
 *     committed, so benchmark progression survives across machines and is
 *     reviewable in git history.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { percentile } from "./stats";
import type { SonarLedgerEntry, SonarRunRecord } from "./types";

export const RUNS_DIR = ".sonar/runs";
export const LEDGER_PATH = "evals/sonar/ledger.jsonl";

export function toLedgerEntry(record: SonarRunRecord): SonarLedgerEntry {
  const agg = record.aggregates;
  return {
    runId: record.runId,
    at: record.startedAt,
    sonarVersion: record.sonarVersion,
    suite: record.suite.name,
    suiteVersion: record.suite.version,
    git: record.git ? `${record.git.sha}${record.git.dirty ? "*" : ""}` : null,
    label: record.label,
    model: record.observed.models[0] ?? record.config.model,
    tts:
      record.observed.ttsProviders.length > 0
        ? `${record.observed.ttsProviders.join("/")}${
            record.observed.ttsVoices[0] ? `:${record.observed.ttsVoices[0]}` : ""
          }`
        : record.config.ttsVoice,
    turns: record.turns.length,
    errors: record.errors,
    costUsd: record.totalCostUsd,
    v2vP50: agg["voice-to-voice"]?.p50 ?? null,
    v2vP95: agg["voice-to-voice"]?.p95 ?? null,
    sttP50: agg["stt.endpoint-to-word"]?.p50 ?? null,
    vsTtfaP50: agg["vs.ttfa"]?.p50 ?? null,
    llmTtftP50: agg["server.llm.ttft"]?.p50 ?? null,
    orchestrateP50: agg["orchestrate.total"]?.p50 ?? null,
  };
}

export function writeRunRecord(record: SonarRunRecord, repoRoot: string): string {
  const dir = path.join(repoRoot, RUNS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = record.startedAt.replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${record.suite.name}-${record.runId.slice(0, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return file;
}

export function appendLedger(record: SonarRunRecord, repoRoot: string): string {
  const file = path.join(repoRoot, LEDGER_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(toLedgerEntry(record)) + "\n");
  return file;
}

export function loadLedger(repoRoot: string): SonarLedgerEntry[] {
  const file = path.join(repoRoot, LEDGER_PATH);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as SonarLedgerEntry);
}

/**
 * Render the progression table: one row per run, chronological, with a
 * break line whenever the Sonar minor version changes (numbers across that
 * line are not comparable).
 */
export function renderProgression(entries: SonarLedgerEntry[], opts?: { suite?: string; last?: number }): string {
  let rows = entries;
  if (opts?.suite) rows = rows.filter((e) => e.suite === opts.suite);
  rows = [...rows].sort((a, b) => a.at.localeCompare(b.at));
  if (opts?.last && rows.length > opts.last) rows = rows.slice(-opts.last);
  if (rows.length === 0) return "No Sonar runs in the ledger yet. Run: npm run sonar -- run --suite voice-baseline";

  const header = [
    "when",
    "sonar",
    "suite",
    "git",
    "model",
    "tts",
    "label",
    "v2v p50",
    "v2v p95",
    "stt p50",
    "vs.ttfa p50",
    "llm p50",
    "orch p50",
    "err",
    "cost",
  ];
  const table: string[][] = [header];
  let prevMinor: string | null = null;
  const breaks: number[] = [];
  for (const e of rows) {
    const minor = e.sonarVersion.split(".").slice(0, 2).join(".");
    if (prevMinor !== null && minor !== prevMinor) breaks.push(table.length);
    prevMinor = minor;
    table.push([
      e.at.slice(0, 16).replace("T", " "),
      e.sonarVersion,
      `${e.suite}@${e.suiteVersion}`,
      e.git ?? "–",
      e.model ?? "–",
      e.tts ?? "–",
      e.label ?? "–",
      ms(e.v2vP50),
      ms(e.v2vP95),
      ms(e.sttP50),
      ms(e.vsTtfaP50),
      ms(e.llmTtftP50),
      ms(e.orchestrateP50),
      String(e.errors),
      e.costUsd ? `$${e.costUsd.toFixed(4)}` : "–",
    ]);
  }

  const widths = header.map((_, col) => Math.max(...table.map((row) => row[col].length)));
  const lines = table.map((row, i) => {
    const line = row.map((cell, col) => cell.padEnd(widths[col])).join("  ");
    return i === 0 ? `${line}\n${"-".repeat(line.length)}` : line;
  });
  // Insert methodology-break separators bottom-up so indices stay valid.
  for (const breakIdx of breaks.reverse()) {
    lines.splice(
      breakIdx,
      0,
      `~~~ sonar minor version changed — rows above/below are not comparable ~~~`,
    );
  }
  return lines.join("\n");
}

export function renderRunSummary(record: SonarRunRecord): string {
  // Cold (turn-1, session entry) vs warm (subsequent) voice-to-voice — the
  // axis the prewarm experiment moves; the blended p50 hides it.
  const v2vAt = (pred: (turnIndex: number) => boolean): number | null => {
    const vals = record.turns
      .filter((t) => pred(t.turnIndex))
      .map((t) => t.spans["voice-to-voice"])
      .filter((v): v is number => typeof v === "number");
    return vals.length ? Math.round(percentile(vals, 50) * 10) / 10 : null;
  };
  const coldP50 = v2vAt((i) => i === 0);
  const warmP50 = v2vAt((i) => i > 0);

  const lines: string[] = [
    `run ${record.runId.slice(0, 8)} · sonar v${record.sonarVersion} · ${record.suite.name}@${record.suite.version}` +
      (record.label ? ` · "${record.label}"` : ""),
    `${record.turns.length} turns · ${record.errors} errors · models=[${record.observed.models.join(", ")}] · ` +
      `cost=$${record.totalCostUsd.toFixed(4)} (llm $${sumUsage(record, "estimatedCostUsd").toFixed(4)} + tts $${sumUsage(record, "ttsCostUsd").toFixed(4)} est)` +
      (record.config.prewarm ? " · prewarmed" : ""),
    `voice-to-voice · cold (turn-1) p50 ${ms(coldP50)} · warm p50 ${ms(warmP50)}`,
    "",
    `${"span".padEnd(20)} ${"n".padStart(3)} ${"p50".padStart(8)} ${"p90".padStart(8)} ${"p95".padStart(8)} ${"mean".padStart(8)} ${"max".padStart(8)}`,
  ];
  for (const [span, agg] of Object.entries(record.aggregates)) {
    if (!agg) continue;
    lines.push(
      `${span.padEnd(20)} ${String(agg.count).padStart(3)} ${ms(agg.p50).padStart(8)} ${ms(agg.p90).padStart(8)} ${ms(agg.p95).padStart(8)} ${ms(agg.mean).padStart(8)} ${ms(agg.max).padStart(8)}`,
    );
  }
  return lines.join("\n");
}

function sumUsage(record: SonarRunRecord, field: "estimatedCostUsd" | "ttsCostUsd"): number {
  return record.turns.reduce((acc, t) => acc + (t.usage[field] ?? 0), 0);
}

function ms(value: number | null): string {
  return value === null ? "–" : `${Math.round(value)}ms`;
}
