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

import {
  SONAR_VERSION,
  SUITES,
  RECORDINGS_DIR,
  appendLedger,
  ensureFixture,
  loadLedger,
  recordingExists,
  renderProgression,
  renderRunSummary,
  runSonarSuite,
  writeRunRecord,
  type SonarGitInfo,
} from "@odyssey/sonar";

const REPO_ROOT = process.cwd();
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (command === "run") return runCommand();
  if (command === "synth") return synthCommand();
  if (command === "recordings") return recordingsCommand();
  if (command === "report") return reportCommand();
  if (command === "suites") return suitesCommand();
  console.log(
    `Odyssey Sonar v${SONAR_VERSION} — voice-to-voice latency benchmarks\n\n` +
      `Commands:\n` +
      `  run --suite <name>        run a benchmark suite (audio in → audio out)\n` +
      `  synth --suite <name>      pre-build the spoken-input fixtures\n` +
      `  recordings --suite <name> list the real recordings a suite needs (+ what's missing)\n` +
      `  report                    show benchmark progression from the ledger\n` +
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

async function synthCommand() {
  const suiteName = readFlag("--suite");
  if (!suiteName) throw new Error("Missing --suite. Available: " + Object.keys(SUITES).join(", "));
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`Unknown suite "${suiteName}". Available: ` + Object.keys(SUITES).join(", "));
  console.log(`Synthesizing ${suite.turns.length} input fixture(s) for ${suite.name}…`);
  let built = 0;
  for (let i = 0; i < suite.turns.length; i += 1) {
    const { file, synthesized } = await ensureFixture({
      repoRoot: REPO_ROOT,
      suite: suite.name,
      turnIndex: i,
      text: suite.turns[i],
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

function suitesCommand() {
  for (const suite of Object.values(SUITES)) {
    console.log(
      `${suite.name}@${suite.version} · ${suite.mode} · ${suite.sessions}×${suite.turns.length} turns · character=${suite.character}\n  ${suite.description ?? ""}`,
    );
  }
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
