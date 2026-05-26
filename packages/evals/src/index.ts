/**
 * @odyssey/evals — character regression + optimization harness.
 *
 * Public surface:
 *   - Types: Probe, ProbeSuite, EvalRun, ProbeResult, CharacterSnapshot
 *   - Runner: runEvalSuite (top-level entrypoint)
 *   - Snapshot: captureCharacterSnapshot
 *   - Judge: judgeResponse (usually invoked by runner; exposed for testing)
 *   - Reporter: writeEvalRun, summaryLine
 *
 * Consumers: `scripts/eval.ts` (CLI), future harness UI in apps/admin.
 */

export type {
  Probe,
  ProbeCategory,
  ProbeSuite,
  ProbeResult,
  EvalRun,
  CharacterSnapshot,
  DimensionScore,
  ScoreDimension,
} from "./types";

export { captureCharacterSnapshot } from "./snapshot";
export { runEvalSuite } from "./runner";
export type { RunOptions, ProgressEvent } from "./runner";
export { judgeResponse, buildJudgeUserPrompt, JUDGE_SYSTEM_PROMPT } from "./judge";
export type { JudgeInput, Judgement } from "./judge";
export {
  writeEvalRun,
  summaryLine,
  writeSweepResult,
  writeEvalRunToDb,
  writeSweepResultToDb,
} from "./reporter";
export type {
  WriteResult,
  WriteSweepResult,
  WriteDbResult,
  WriteSweepDbResult,
} from "./reporter";

export { runEvalSweep, expandSweep } from "./sweep";
export type {
  SweepSpec,
  SweepConfig,
  SweepProgress,
  SweepRunOptions,
  SweepResult,
  ConfigRanking,
} from "./sweep";

export { launchEvalRunInBackground, launchEvalSweepInBackground } from "./background";
export type {
  LaunchRunInput,
  LaunchSweepInput,
  LaunchedRun,
  LaunchedSweep,
} from "./background";
