/**
 * Odyssey Sonar CLI — emit a ping, time the echo.
 *
 * Voice-to-voice benchmarks: every turn starts from spoken audio (a
 * synthesized user utterance) streamed into STT, runs through the real
 * admin routes, and is timed to the agent's first audio. Progression is
 * tracked across runs in a committed ledger.
 *
 * Usage:
 *   npm run sonar -- run --suite voice-baseline --label "baseline"
 *   npm run sonar -- run --suite scene-baseline --label "drop commit hold to 400ms"
 *   npm run sonar -- run --suite voice-baseline --model claude-haiku-4-5 --sessions 5
 *   npm run sonar -- synth --suite voice-baseline      # pre-build input fixtures
 *   npm run sonar -- report [--suite voice-baseline] [--last 20]
 *   npm run sonar -- judge-agency --latest
 *   npm run sonar -- context-run --suite context-activation-baseline
 *   npm run sonar -- score-context --latest
 *   npm run sonar -- suites
 *
 * Flags for `run`:
 *   --suite <name>      required; see `suites` command
 *   --base <url>        default http://localhost:3001
 *   --character <slug>  override the suite's character
 *   --model <id>        override the character's voice model
 *   --tts-voice <slug>  route TTS through a voices-table slug (A/B providers),
 *                       e.g. --tts-voice liam (elevenlabs) vs the default pocket binding
 *   --commit-hold-ms <n> model the sandbox commit hold so v2v = TRUE felt latency
 *                       (0 = pipeline-intrinsic; production is 1500)
 *   --prewarm           warm the session context cache at open (like the real
 *                       client) so turn-1 skips curator/retrieval
 *   --sessions <n>      override the suite's session count
 *   --label "<text>"    name the change under test (shows in the ledger)
 *   --cookie <cookie>   or ODYSSEY_ADMIN_COOKIE env
 *   --audio-rt-ws <url> override the STT WebSocket (or AUDIO_RT_WS_URL env)
 *   --turbo             stream STT frames as fast as possible — NON-representative
 *                       endpointing, smoke checks only
 *   --no-ledger         write the run record but skip the committed ledger
 *
 * Needs OPENAI_API_KEY (to synthesize input fixtures the first time) and an
 * admin session cookie. Uses real providers and incurs model/TTS cost.
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { getCharacterStore } from "@odyssey/db";
import {
  AGENCY_SCORES_PATH,
  CONTEXT_ACTIVATION_SCORES_PATH,
  SONAR_VERSION,
  RUNS_DIR,
  SONAR_SPANS,
  SUITES,
  RECORDINGS_DIR,
  aggregate,
  appendLedger,
  ensureFixture,
  loadLedger,
  judgeAgencyRun,
  recordingExists,
  renderProgression,
  renderRunSummary,
  resolveUtteranceSamples,
  runSonarSuite,
  scoreContextActivationRun,
  upsertAgencyScore,
  upsertContextActivationScore,
  writeRunRecord,
  type AgencyScoreRecord,
  type ContextActivationScoreRecord,
  type SonarGitInfo,
  type SonarRunRecord,
  type SonarSpanName,
  type SonarSuite,
  type SonarTurnRecord,
  type SonarUtterance,
  type TraceContract,
} from "@odyssey/sonar";
import { curate } from "@odyssey/wiki-curator";

const REPO_ROOT = process.cwd();
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (command === "run") return runCommand();
  if (command === "context-run") return contextRunCommand();
  if (command === "synth") return synthCommand();
  if (command === "recordings") return recordingsCommand();
  if (command === "report") return reportCommand();
  if (command === "judge-agency") return judgeAgencyCommand();
  if (command === "score-context") return scoreContextCommand();
  if (command === "suites") return suitesCommand();
  console.log(
    `Odyssey Sonar v${SONAR_VERSION} — world simulation benchmarks\n\n` +
      `Commands:\n` +
      `  run --suite <name>        run a benchmark suite (audio in → audio out)\n` +
      `  context-run               run context activation directly through the curator\n` +
      `  synth --suite <name>      pre-build the spoken-input fixtures\n` +
      `  recordings --suite <name> list the real recordings a suite needs (+ what's missing)\n` +
      `  report                    show benchmark progression from the ledger\n` +
      `  judge-agency              score an agency-baseline run and write ${AGENCY_SCORES_PATH}\n` +
      `  score-context             score context activation and write ${CONTEXT_ACTIVATION_SCORES_PATH}\n` +
      `  suites                    list available suites`,
  );
  if (command) process.exit(1);
}

async function runCommand() {
  const suiteName = readFlag("--suite");
  if (!suiteName) throw new Error("Missing --suite. Available: " + Object.keys(SUITES).join(", "));
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`Unknown suite "${suiteName}". Available: ` + Object.keys(SUITES).join(", "));

  const cookie = readFlag("--cookie") ?? process.env.ODYSSEY_ADMIN_COOKIE ?? undefined;
  // STT-only (endpointing) suites hit only audio-rt — no admin auth needed.
  if (!cookie && !suite.sttOnly) {
    throw new Error(
      "No admin auth. The voice-stream/orchestrate routes are behind admin auth — pass a session\n" +
        "cookie via --cookie or the ODYSSEY_ADMIN_COOKIE env var (same as scripts/smoke-test-voice-session.ts).\n" +
        "Grab it from your browser devtools after signing in to the admin app (the authjs.session-token cookie).",
    );
  }

  const record = await runSonarSuite({
    suite,
    baseUrl: readFlag("--base") ?? "http://localhost:3001",
    cookie: cookie ?? "",
    repoRoot: REPO_ROOT,
    character: readFlag("--character") ?? undefined,
    model: readFlag("--model") ?? undefined,
    ttsVoice: readFlag("--tts-voice") ?? undefined,
    commitHoldMs: readNumberFlag("--commit-hold-ms"),
    prewarm: hasFlag("--prewarm"),
    sessions: readNumberFlag("--sessions"),
    turbo: hasFlag("--turbo"),
    audioRtWsUrl: readFlag("--audio-rt-ws") ?? undefined,
    label: readFlag("--label") ?? undefined,
    git: gitInfo(),
    log: (line) => console.log(line),
  });

  console.log("\n" + renderRunSummary(record));
  const recordFile = writeRunRecord(record, REPO_ROOT);
  console.log(`\nrun record → ${recordFile}`);
  // Only commit a ledger row for a CLEAN run (zero errors). A partial run
  // (dead model id, rate limits) has biased percentiles — its survivors
  // skew toward whichever turns happened to succeed — so it stays in the
  // per-run record for inspection but never pollutes the progression table.
  const hasSignal = Boolean(record.aggregates["voice-to-voice"]) || record.endpointing !== null;
  const clean = hasSignal && record.errors === 0;
  if (hasFlag("--no-ledger")) {
    // skip
  } else if (clean) {
    const ledgerFile = appendLedger(record, REPO_ROOT);
    console.log(`ledger     → ${ledgerFile} (commit this to track progression)`);
  } else {
    console.log(
      `ledger     → skipped (${record.errors} error(s); only clean runs are recorded)`,
    );
  }
  if (record.errors > 0) {
    console.error(`\n${record.errors} turn(s) errored — see the run record for details.`);
    process.exit(1);
  }
}

async function contextRunCommand() {
  const suiteName = readFlag("--suite") ?? "context-activation-baseline";
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`Unknown suite "${suiteName}". Available: ` + Object.keys(SUITES).join(", "));
  if (!suite.contextActivation) {
    throw new Error(`Suite "${suiteName}" has no contextActivation gold labels.`);
  }

  const characterSlug = readFlag("--character") ?? suite.character;
  const model = readFlag("--model") ?? "gpt-oss-120b";
  const sessions = readNumberFlag("--sessions") ?? suite.sessions;
  const tokenBudget = readNumberFlag("--token-budget") ?? 3000;
  const simulateSttDrift = hasFlag("--simulate-stt-drift");
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const character = await getCharacterStore().getBySlug(characterSlug);
  if (!character) throw new Error(`Character not found: ${characterSlug}`);

  console.log(
    `context-run · suite=${suite.name}@${suite.version} · character=${characterSlug} · ` +
      `${sessions} session(s) × ${suite.turns.length} turn(s)` +
      (simulateSttDrift ? " · simulated STT drift" : ""),
  );

  const turns: SonarTurnRecord[] = [];
  for (let sessionIndex = 0; sessionIndex < sessions; sessionIndex += 1) {
    console.log(`session ${sessionIndex + 1}/${sessions} · context-only`);
    for (let turnIndex = 0; turnIndex < suite.turns.length; turnIndex += 1) {
      const scripted = displayTextForUtterance(suite.turns[turnIndex]);
      const transcript = simulateSttDrift ? applyContextSttDrift(scripted) : scripted;
      const turnStartedAt = new Date().toISOString();
      const t0 = performance.now();
      const result = await curate({
        characterId: character.id,
        query: transcript,
        tokenBudget,
      });
      const elapsedMs = Math.round((performance.now() - t0) * 10) / 10;
      const selectedPageSlugs = result.pages.map((selected) => selected.page.slug);
      const trace: TraceContract = {
        startedAt: turnStartedAt,
        elapsedMs,
        events: [
          {
            name: "server.request.received",
            elapsedMs: 0,
            meta: { contextOnly: true },
          },
          {
            name: "server.curator.start",
            elapsedMs: 0,
            meta: { contextOnly: true },
          },
          {
            name: "server.curator.done",
            elapsedMs,
            meta: {
              contextOnly: true,
              selectedPages: selectedPageSlugs.length,
              selectedPageSlugs,
              tokensUsed: result.tokensUsed,
              tokensBudget: result.tokensBudget,
            },
          },
          {
            name: "server.context.attached",
            elapsedMs,
            meta: {
              contextOnly: true,
              contextCacheHit: false,
              retrievalSkipped: true,
              semanticHits: 0,
              selectedPages: selectedPageSlugs.length,
              selectedPageSlugs,
              wikiPromptChunkChars: result.promptChunk.length,
            },
          },
        ],
      };

      turns.push({
        sessionIndex,
        turnIndex,
        message: scripted,
        responseText: "",
        orchestratorPrompt: null,
        utterance: { kind: "complete", finals: 1, cutoff: false },
        stt: {
          transcript,
          scripted,
          wordCount: transcript.split(/\s+/).filter(Boolean).length,
          fixtureSynthesized: false,
        },
        spans: {
          "server.curator": elapsedMs,
          "server.context": elapsedMs,
        },
        flags: {
          contextCacheHit: false,
          retrievalSkipped: true,
          ackDelivered: false,
          ttsFallback: false,
          sttEmpty: false,
          error: null,
        },
        usage: emptyTurnUsage(model),
        serverTrace: trace,
        orchestrateTrace: null,
      });

      console.log(
        `  turn ${turnIndex + 1}/${suite.turns.length} · curator=${Math.round(elapsedMs)}ms · ` +
          `${selectedPageSlugs.length} pages · ${result.tokensUsed}/${result.tokensBudget} tokens · "${truncate(scripted)}"`,
      );
    }
  }

  const record: SonarRunRecord = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    sonarVersion: SONAR_VERSION,
    suite: { name: suite.name, version: suite.version, mode: "context" },
    git: gitInfo(),
    baseUrl: "context-only",
    label: readFlag("--label") ?? null,
    config: {
      character: characterSlug,
      model,
      ttsVoice: null,
      commitHoldMs: 0,
      prewarm: false,
      sessions,
      turnsPerSession: suite.turns.length,
    },
    observed: {
      providers: [],
      models: [model],
      ttsProviders: [],
      ttsVoices: [],
    },
    turns,
    aggregates: aggregateTurnSpans(turns),
    endpointing: null,
    errors: 0,
    totalCostUsd: 0,
  };

  console.log("\n" + renderRunSummary(record));
  const recordFile = writeRunRecord(record, REPO_ROOT);
  console.log(`\nrun record → ${recordFile}`);
  if (hasFlag("--no-ledger")) {
    console.log("ledger     → skipped (--no-ledger)");
  } else {
    const ledgerFile = appendLedger(record, REPO_ROOT);
    console.log(`ledger     → ${ledgerFile} (commit this to track progression)`);
  }
}

async function synthCommand() {
  const suiteName = readFlag("--suite");
  if (!suiteName) throw new Error("Missing --suite. Available: " + Object.keys(SUITES).join(", "));
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`Unknown suite "${suiteName}". Available: ` + Object.keys(SUITES).join(", "));
  console.log(`Synthesizing ${suite.turns.length} input fixture(s) for ${suite.name}…`);
  let built = 0;
  for (let i = 0; i < suite.turns.length; i += 1) {
    const turn = suite.turns[i];
    if (typeof turn === "object" && "recording" in turn) {
      console.log(`  turn ${i} recording fixture → ${RECORDINGS_DIR}/${turn.recording}.wav`);
      continue;
    }
    if (typeof turn === "object" && "parts" in turn) {
      const { synthesized } = await resolveUtteranceSamples({
        repoRoot: REPO_ROOT,
        suite: suite.name,
        turnIndex: i,
        parts: turn.parts,
        gapMs: turn.gapMs ?? 1000,
        opts: { voice: suite.userVoice },
        log: (line) => console.log(line),
      });
      if (synthesized) built += 1;
      console.log(`  turn ${i} ${synthesized ? "synthesized" : "cached"} → ${turn.parts.length} part(s)`);
      continue;
    }
    const { file, synthesized } = await ensureFixture({
      repoRoot: REPO_ROOT,
      suite: suite.name,
      turnIndex: i,
      text: turn,
      opts: { voice: suite.userVoice },
      log: (line) => console.log(line),
    });
    if (synthesized) built += 1;
    console.log(`  turn ${i} ${synthesized ? "synthesized" : "cached"} → ${file}`);
  }
  console.log(`Done · ${built} synthesized, ${suite.turns.length - built} already cached.`);
}

function recordingsCommand() {
  const suiteName = readFlag("--suite");
  if (!suiteName) throw new Error("Missing --suite. Available: " + Object.keys(SUITES).join(", "));
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`Unknown suite "${suiteName}". Available: ` + Object.keys(SUITES).join(", "));

  const recordings = suite.turns
    .map((t) => (typeof t === "object" && "recording" in t ? t : null))
    .filter((t): t is { recording: string; kind: "complete" | "paused"; script?: string } => t !== null);

  if (recordings.length === 0) {
    console.log(`Suite "${suite.name}" uses synthesized audio — no recordings needed.`);
    return;
  }

  console.log(
    `Recordings for ${suite.name}@${suite.version} — drop mono WAVs (any sample rate; Sonar\n` +
      `resamples to 24kHz) at ${RECORDINGS_DIR}/<name>.wav. Record "pause" clips with a\n` +
      `genuine mid-sentence hesitation — don't let your pitch fall as if finishing.\n`,
  );
  let missing = 0;
  for (const r of recordings) {
    const present = recordingExists(REPO_ROOT, r.recording);
    if (!present) missing += 1;
    console.log(
      `  [${present ? "✓" : " "}] ${r.recording.padEnd(13)} ${r.kind.padEnd(9)} ${r.script ?? ""}`,
    );
  }
  console.log(
    `\n${recordings.length - missing}/${recordings.length} present` +
      (missing > 0 ? ` · ${missing} still to record, then: npm run sonar -- run --suite ${suite.name} --audio-rt-ws ws://127.0.0.1:8089/api/asr-streaming` : " · ready to run"),
  );
}

function reportCommand() {
  const entries = loadLedger(REPO_ROOT);
  console.log(
    renderProgression(entries, {
      suite: readFlag("--suite") ?? undefined,
      last: readNumberFlag("--last"),
    }),
  );
}

async function judgeAgencyCommand() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for Agency judging");

  const record = loadAgencyRunRecord();
  const judgeModel = readFlag("--judge") ?? "claude-opus-4-5";

  console.log(
    `judging Agency · run ${record.runId.slice(0, 8)} · ${record.suite.name}@${record.suite.version} · ` +
      `${record.turns.length} turns · judge=${judgeModel}`,
  );
  const score = await judgeAgencyRun(record, { judgeModel, apiKey });
  printAgencyScore(score);

  if (hasFlag("--dry-run")) {
    console.log("\ndry run — score not written");
    return;
  }

  const file = upsertAgencyScore(REPO_ROOT, score);
  console.log(`\nagency score → ${file}`);
}

function scoreContextCommand() {
  const record = loadRunRecordFromFlags("context-activation-baseline");
  console.log(
    `scoring Context Activation · run ${record.runId.slice(0, 8)} · ${record.suite.name}@${record.suite.version} · ` +
      `${record.turns.length} turns`,
  );
  const score = scoreContextActivationRun(record);
  printContextActivationScore(score);

  if (hasFlag("--dry-run")) {
    console.log("\ndry run — score not written");
    return;
  }

  const file = upsertContextActivationScore(REPO_ROOT, score);
  console.log(`\ncontext activation score → ${file}`);
}

function suitesCommand() {
  for (const suite of Object.values(SUITES)) {
    console.log(
      `${suite.name}@${suite.version} · ${suite.mode} · ${suite.sessions}×${suite.turns.length} turns · character=${suite.character}\n  ${suite.description ?? ""}`,
    );
  }
}

function loadAgencyRunRecord(): SonarRunRecord {
  return loadRunRecordFromFlags("agency-baseline");
}

function loadRunRecordFromFlags(defaultSuite: string): SonarRunRecord {
  const fileFlag = readFlag("--file");
  if (fileFlag) return readRunRecord(path.resolve(REPO_ROOT, fileFlag));

  const runId = readFlag("--run-id");
  if (runId) {
    const file = findRunRecordFile((candidate) => candidate.runId.startsWith(runId));
    if (!file) throw new Error(`No run record found for --run-id ${runId}`);
    return readRunRecord(file);
  }

  const suite = readFlag("--suite") ?? defaultSuite;
  const file = findRunRecordFile((candidate) => candidate.suite.name === suite, { latest: true });
  if (!file) {
    throw new Error(
      `No local ${suite} run record found in ${RUNS_DIR}. Run: npm run sonar -- run --suite ${suite}`,
    );
  }
  return readRunRecord(file);
}

function findRunRecordFile(
  predicate: (record: SonarRunRecord) => boolean,
  opts?: { latest?: boolean },
): string | null {
  const dir = path.join(REPO_ROOT, RUNS_DIR);
  if (!fs.existsSync(dir)) return null;
  const matches: Array<{ file: string; at: string }> = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    try {
      const record = readRunRecord(file);
      if (predicate(record)) matches.push({ file, at: record.startedAt });
    } catch {
      // Ignore malformed local files; explicit --file surfaces parse errors.
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.at.localeCompare(b.at));
  return opts?.latest ? matches[matches.length - 1].file : matches[0].file;
}

function readRunRecord(file: string): SonarRunRecord {
  if (!fs.existsSync(file)) throw new Error(`Run record not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as SonarRunRecord;
}

function printAgencyScore(score: AgencyScoreRecord) {
  console.log(`score: ${score.score.toFixed(1)}/100`);
  console.log("dimensions:");
  for (const [key, value] of Object.entries(score.dimensions)) {
    console.log(`  ${key.padEnd(20)} ${value.toFixed(1)}`);
  }
  if (score.penalties.length > 0) {
    console.log("penalties:");
    for (const penalty of score.penalties) {
      console.log(
        `  -${penalty.points} ${penalty.type}` +
          (penalty.turn ? ` turn ${penalty.turn}` : "") +
          (penalty.rationale ? ` · ${penalty.rationale}` : ""),
      );
    }
  }
  if (score.notes) console.log(`notes: ${score.notes}`);
}

function printContextActivationScore(score: ContextActivationScoreRecord) {
  console.log(`score: ${score.score.toFixed(1)}/100`);
  console.log("dimensions:");
  for (const [key, value] of Object.entries(score.dimensions)) {
    console.log(`  ${key.padEnd(24)} ${value.toFixed(1)}`);
  }
  console.log("metrics:");
  console.log(`  traced turns             ${score.metrics.tracedTurns}/${score.metrics.turns}`);
  console.log(`  context turns            ${score.metrics.contextTurns}/${score.metrics.tracedTurns}`);
  console.log(`  cache hits               ${score.metrics.cacheHits}/${score.metrics.cacheEligibleTurns}`);
  console.log(`  stale cache bypasses     ${score.metrics.staleCacheMisses}`);
  if (score.metrics.avgSelectedPages !== null) {
    console.log(`  avg selected pages       ${score.metrics.avgSelectedPages.toFixed(1)}`);
  }
  if (score.metrics.avgTokenBudgetUse !== null) {
    console.log(`  avg token budget use     ${(score.metrics.avgTokenBudgetUse * 100).toFixed(0)}%`);
  }
  if (score.metrics.labeledTurns > 0) {
    console.log(`  labeled turns            ${score.metrics.labeledTurns}`);
    console.log(`  page recall              ${score.metrics.pageRecall !== null ? `${(score.metrics.pageRecall * 100).toFixed(1)}%` : "-"}`);
    console.log(`  page precision           ${score.metrics.pagePrecision !== null ? `${(score.metrics.pagePrecision * 100).toFixed(1)}%` : "-"}`);
    console.log(`  forbidden page hits      ${score.metrics.forbiddenPageHits}`);
  }
  if (score.metrics.retrievalMs) {
    console.log(`  retrieval p50/p95        ${score.metrics.retrievalMs.p50}ms / ${score.metrics.retrievalMs.p95}ms`);
  }
  if (score.metrics.curatorMs) {
    console.log(`  curator p50/p95          ${score.metrics.curatorMs.p50}ms / ${score.metrics.curatorMs.p95}ms`);
  }
  if (score.metrics.contextAttachMs) {
    console.log(`  context attach p50/p95   ${score.metrics.contextAttachMs.p50}ms / ${score.metrics.contextAttachMs.p95}ms`);
  }
  if (score.notes) console.log(`notes: ${score.notes}`);
}

function displayTextForUtterance(turn: SonarUtterance): string {
  if (typeof turn === "string") return turn;
  if ("recording" in turn) return turn.script ?? turn.recording;
  return turn.parts.join(" … ");
}

function applyContextSttDrift(value: string): string {
  return value
    .replace(/\bMamre\b/g, "mammary")
    .replace(/\bHaran\b/g, "Huran");
}

function emptyTurnUsage(model: string) {
  return {
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    provider: null,
    model,
    ttsProvider: null,
    ttsVoice: null,
    ttsChars: null,
    ttsCostUsd: null,
  };
}

function aggregateTurnSpans(turns: SonarTurnRecord[]): SonarRunRecord["aggregates"] {
  const aggregates: SonarRunRecord["aggregates"] = {};
  for (const span of SONAR_SPANS) {
    const values = turns
      .map((turn) => turn.spans[span as SonarSpanName])
      .filter((value): value is number => typeof value === "number");
    const spanAggregate = aggregate(values);
    if (spanAggregate) aggregates[span as SonarSpanName] = spanAggregate;
  }
  return aggregates;
}

function truncate(value: string, max = 48): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function gitInfo(): SonarGitInfo | null {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    return { sha, branch, dirty };
  } catch {
    return null;
  }
}

function readFlag(name: string): string | null {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

function readNumberFlag(name: string): number | undefined {
  const raw = readFlag(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
