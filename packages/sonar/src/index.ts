export { SONAR_VERSION } from "./version";
export * from "./types";
export { runSonarSuite, type RunSonarSuiteOptions } from "./runner";
export { extractVoiceStreamSpans, extractServerTrace } from "./spans";
export { readTimedSseFrames } from "./sse";
export { aggregate, percentile } from "./stats";
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
export { SUITES, VOICE_BASELINE, SCENE_BASELINE, ENDPOINTING } from "./suites";
export { TTS_USD_PER_1K_CHARS, estimateTtsCostUsd } from "./tts-pricing";

// Voice I/O primitives (audio-rt STT client, fixture synthesis, WAV/codec).
export { streamUtterance, DEFAULT_AUDIO_RT_WS_URL, type SttResult } from "./audio/stt-client";
export { ensureFixture, synthToWav, FIXTURES_DIR } from "./audio/synth";
export { loadUtterance24k, decodeWav } from "./audio/wav";
