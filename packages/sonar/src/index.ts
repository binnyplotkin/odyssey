export { SONAR_VERSION } from "./version";
export * from "./types";
export { runSonarSuite, type RunSonarSuiteOptions } from "./runner";
export { extractVoiceStreamSpans, extractServerTrace } from "./spans";
export { readTimedSseFrames } from "./sse";
export { aggregate, percentile, sloAttainmentPct } from "./stats";
export {
  RUNS_DIR,
  LEDGER_PATH,
  writeRunRecord,
  appendLedger,
  loadLedger,
  toLedgerEntry,
  renderProgression,
  renderRunSummary,
} from "./record";
export {
  SUITES,
  VOICE_BASELINE,
  SCENE_BASELINE,
  AGENCY_BASELINE,
  CONTEXT_ACTIVATION_BASELINE,
  ENDPOINTING,
  REAL_ENDPOINTING,
} from "./suites";
export {
  AGENCY_DIMENSIONS,
  AGENCY_JUDGE_SYSTEM_PROMPT,
  AGENCY_SCORES_PATH,
  buildAgencyJudgeUserPrompt,
  computeAgencyScore,
  judgeAgencyRun,
  loadAgencyScores,
  upsertAgencyScore,
  type AgencyDimension,
  type AgencyPenalty,
  type AgencyScoreRecord,
} from "./agency";
export {
  CONTEXT_ACTIVATION_DIMENSIONS,
  CONTEXT_ACTIVATION_SCORES_PATH,
  collectContextActivationMetrics,
  computeContextActivationScore,
  loadContextActivationScores,
  scoreContextActivationRun,
  upsertContextActivationScore,
  type ContextActivationDimension,
  type ContextActivationMetrics,
  type ContextActivationScoreRecord,
} from "./context-activation";
export { TTS_USD_PER_1K_CHARS, estimateTtsCostUsd } from "./tts-pricing";

// Voice I/O primitives (audio-rt STT client, fixture synthesis, WAV/codec).
export { streamUtterance, DEFAULT_AUDIO_RT_WS_URL, type SttResult } from "./audio/stt-client";
export {
  ensureFixture,
  resolveUtteranceSamples,
  synthToWav,
  FIXTURES_DIR,
  RECORDINGS_DIR,
  loadRecording,
  recordingPath,
  recordingExists,
} from "./audio/synth";
export { loadUtterance24k, decodeWav } from "./audio/wav";
