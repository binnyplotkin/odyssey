/**
 * Sonar type contracts.
 *
 * Two version axes live on every run record:
 *   - sonarVersion: the harness/methodology version (SONAR_VERSION). Runs
 *     are only comparable within the same minor version.
 *   - git + config: the stack under test. This is the axis you expect to
 *     see improve as the pipeline is iterated.
 */

/** A single trace marker as shipped by TraceEnvelope.toJSON(). */
export type TraceContractEvent = {
  name: string;
  elapsedMs: number;
  meta?: Record<string, unknown>;
};

export type TraceContract = {
  startedAt: string;
  elapsedMs: number;
  events: TraceContractEvent[];
};

/** An SSE frame with its arrival time relative to the request POST. */
export type TimedSseFrame = {
  event: string;
  data: Record<string, unknown>;
  /** ms since the runner dispatched the POST. */
  atMs: number;
};

export type SonarSuiteMode = "voice-stream" | "scene";

export type SonarSuite = {
  name: string;
  /** Bump when turns/sessions/mode change — results stop being comparable. */
  version: string;
  description?: string;
  /** Character slug the suite speaks to (CLI can override). */
  character: string;
  /**
   * "voice-stream": audio → STT → /voice-stream (single character).
   * "scene": audio → STT → /orchestrate decision → /voice-stream (full
   * scene loop, like use-scene-player). Both are voice-to-voice.
   */
  mode: SonarSuiteMode;
  /**
   * What the user says each turn. Every string is synthesized once into a
   * spoken-audio fixture (a neutral user voice) and streamed into the STT
   * WebSocket — turns START FROM AUDIO, never from text. Drop a real
   * recording at the fixture path to override synthesis.
   */
  turns: string[];
  /** Neutral OpenAI TTS voice used to synthesize the user's spoken input. */
  userVoice?: string;
  /** Number of fresh sessions to run the script through. */
  sessions: number;
  /** Pause between turns so caches/persistence settle (default 250ms). */
  settleMs?: number;
};

/** Canonical span names. Extraction maps raw trace marks onto these. */
export const SONAR_SPANS = [
  // THE headline: end of user speech → first agent audio. Spans the whole
  // voice path (endpointing + STT + handoff + [orchestrate] + LLM + TTS).
  // Pipeline-intrinsic: excludes the 1500ms client commit hold production
  // currently adds after STT finalizes (a knob we plan to cut).
  "voice-to-voice",
  // STT leg (audio-rt streaming WebSocket):
  "stt.handshake", // ws connect → Ready frame
  "stt.endpoint-to-word", // user speech end → first word (≈800ms VAD + whisper + net)
  "stt.word-span", // first word → last word
  // Client commit hold: the post-STT debounce the sandbox waits before
  // firing the turn (STREAMING_COMMIT_HOLD_MS). Modeled here so v2v reflects
  // TRUE felt latency; 0 (default) = pipeline-intrinsic, comparable to runs
  // that don't model it.
  "commit.hold",
  // Scene-loop overhead (scene mode only):
  "orchestrate.total", // POST /orchestrate → JSON response (client)
  "orchestrate.llm", // orchestrate.llm.start → orchestrate.llm.done (server)
  // Voice-stream leg, client-observed from the POST:
  "vs.ttft", // POST → first `token` frame
  "vs.ttfa", // POST → first `audio` frame
  "vs.total", // POST → `done` frame
  // Voice-stream server-side spans, derived from the serverTrace:
  "server.retrieval", // server.retrieval.start → server.retrieval.done
  "server.curator", // server.curator.start → server.curator.done
  "server.context", // server.request.received → server.context.attached
  "server.llm.ttft", // server.request.received → server.llm.first-token
  "server.llm.duration", // server.llm.first-token → server.llm.done
  "server.tts.ttfa", // first server.tts.chunk.dispatched → server.tts.first-audio
  "server.ttfa.main", // server.request.received → server.tts.first-audio (main reply)
  "server.total", // server.request.received → server.tts.done
] as const;

export type SonarSpanName = (typeof SONAR_SPANS)[number];

export type SonarTurnFlags = {
  contextCacheHit: boolean;
  retrievalSkipped: boolean;
  ackDelivered: boolean;
  ttsFallback: boolean;
  /** STT returned no usable transcript (empty/failed) — turn is unscored. */
  sttEmpty: boolean;
  error: string | null;
};

export type SonarSttInfo = {
  /** The text STT produced from the spoken fixture — what the LLM actually got. */
  transcript: string;
  /** What the user was scripted to say — diff against transcript to gauge WER. */
  scripted: string;
  wordCount: number;
  fixtureSynthesized: boolean;
};

export type SonarTurnUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  provider: string | null;
  model: string | null;
  ttsProvider: string | null;
  ttsVoice: string | null;
};

export type SonarTurnRecord = {
  sessionIndex: number;
  turnIndex: number;
  /** The scripted user utterance (synthesized to the spoken-audio input). */
  message: string;
  stt: SonarSttInfo;
  spans: Partial<Record<SonarSpanName, number | null>>;
  flags: SonarTurnFlags;
  usage: SonarTurnUsage;
  /** Raw server trace, kept for post-hoc digging. */
  serverTrace: TraceContract | null;
  orchestrateTrace: TraceContract | null;
};

export type SonarAggregate = {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
};

export type SonarGitInfo = {
  sha: string;
  branch: string;
  dirty: boolean;
};

export type SonarRunRecord = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  sonarVersion: string;
  suite: { name: string; version: string; mode: SonarSuiteMode };
  git: SonarGitInfo | null;
  baseUrl: string;
  /** Free-text label for the change under test, e.g. "drop commit hold to 400ms". */
  label: string | null;
  config: {
    character: string;
    model: string | null;
    /** TTS voice slug override passed to the route, if any. */
    ttsVoice: string | null;
    /** Modeled client commit-hold (ms) folded into voice-to-voice; 0 = intrinsic. */
    commitHoldMs: number;
    /** Whether the session context cache was warmed at open (like the real client). */
    prewarm: boolean;
    sessions: number;
    turnsPerSession: number;
  };
  /** Providers/models actually observed in done events. */
  observed: { providers: string[]; models: string[]; ttsProviders: string[]; ttsVoices: string[] };
  turns: SonarTurnRecord[];
  aggregates: Partial<Record<SonarSpanName, SonarAggregate>>;
  errors: number;
  totalCostUsd: number;
};

/** Compact one-line-per-run row, committed to the ledger for progression. */
export type SonarLedgerEntry = {
  runId: string;
  at: string;
  sonarVersion: string;
  suite: string;
  suiteVersion: string;
  git: string | null;
  label: string | null;
  model: string | null;
  /** TTS provider:voice actually observed — the A/B axis. */
  tts: string | null;
  turns: number;
  errors: number;
  costUsd: number;
  /** Headline percentiles (ms). */
  v2vP50: number | null; // voice-to-voice p50 — THE number
  v2vP95: number | null;
  sttP50: number | null; // stt.endpoint-to-word p50
  vsTtfaP50: number | null; // voice-stream first-audio p50
  llmTtftP50: number | null; // server LLM TTFT p50
  orchestrateP50: number | null;
};
