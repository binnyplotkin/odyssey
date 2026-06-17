# Odyssey Sonar

Versioned benchmark harness for the Odyssey world simulation pipeline. The
first Sonar layer is **voice-to-voice**: emit a spoken pulse, time the echo.
Every Sonar turn starts from *spoken audio* — a synthesized user utterance
streamed into the audio-rt STT WebSocket at real-time pace — runs through the
real admin routes (STT → optional orchestrator → voice-stream), and is timed
to the agent's first audio. Text-initiated turns don't exist here: they'd hide
the two biggest real costs (VAD endpointing + STT), and Odyssey is
voice-first.

Sonar also owns benchmark suites for world-simulation behavior, including
Agency: the harness's ability to manage turns, accept correction, engage,
repair, and drive the next useful moment in the scene.

It also scores **Context Activation**: the knowledge-graph/content-management
path that retrieves, curates, caches, and injects world context into each
turn.

Each run appends a row to a committed progression ledger, so every pipeline
change shows up as a measurable delta.

## Quick start

```sh
# 1. dev server running (npm run dev:admin); real providers = real cost
# 2. admin auth — same as scripts/smoke-test-voice-session.ts:
export ODYSSEY_ADMIN_COOKIE='authjs.session-token=...'   # from browser devtools after signing in
# 3. OPENAI_API_KEY must be set (used once to synthesize the spoken input fixtures)

npm run sonar -- synth --suite voice-baseline           # pre-build input audio (optional; run does it on demand)
npm run sonar -- run --suite voice-baseline --label "baseline"
npm run sonar -- run --suite agency-baseline --label "agency baseline"
npm run sonar -- judge-agency --latest                  # writes evals/sonar/agency-scores.jsonl
npm run sonar -- run --suite context-activation-baseline --label "context baseline"
npm run sonar -- score-context --latest                 # writes evals/sonar/context-activation-scores.jsonl
npm run sonar -- report                                 # progression table across all runs
npm run sonar -- suites                                 # list available suites
```

## The turn, end to end

```
scripted line ──(OpenAI TTS, once)──▶ spoken-audio fixture (.wav, 24kHz)
      │
      ├─▶ stream into audio-rt /api/asr-streaming at real-time pace
      │      └─ VAD endpointing (800ms silence) → whisper → transcript   [stt.endpoint-to-word]
      │
      ├─▶ (scene mode) POST /orchestrate → decision                      [orchestrate.total]
      │
      └─▶ POST /voice-stream with the transcript
             └─ retrieval → curator → LLM → sentence-chunked TTS         [server.*]
                └─ first agent audio frame                               [vs.ttfa]

voice-to-voice = user speech end ──▶ first agent audio   ◀── THE headline
```

## What gets measured

| Span | Meaning |
|---|---|
| **`voice-to-voice`** | **user speech end → first agent audio — the headline** |
| `stt.handshake` | STT WebSocket connect → Ready |
| `stt.endpoint-to-word` | speech end → first transcribed word (≈800ms VAD + whisper + net) |
| `stt.word-span` | first word → last word |
| `orchestrate.total` | scene mode: the /orchestrate round trip |
| `vs.ttft` / `vs.ttfa` / `vs.total` | voice-stream POST → first token / first audio / done |
| `server.*` | retrieval, curator, context, LLM TTFT/duration, TTS TTFA, total (from the route's `TraceEnvelope`) |

Per-turn flags record context-cache hits, retrieval skips, ack delivery,
TTS fallbacks, and STT-empty so percentiles can be segmented. Each turn also
stores the STT transcript next to the scripted line, so you can eyeball WER.

**Commit hold — intrinsic vs felt.** By default `voice-to-voice` is
*pipeline-intrinsic*: it omits the client commit hold
(`STREAMING_COMMIT_HOLD_MS`, 1500ms in prod) the sandbox waits after STT
finalizes before firing the turn. Pass `--commit-hold-ms <n>` to model it and
get **TRUE felt latency** — the number a user feels entering a world. Run
both: intrinsic (default, comparable across stack changes) and felt
(`--commit-hold-ms 1500`, the real experience). Caveat: the hold guards
against cutting users off on natural pauses; Sonar's single-utterance
fixtures can't see that quality cost, so a latency win from shrinking it is
necessary-but-not-sufficient evidence to change the production constant.

## Input audio: synthesis vs recordings

Fixtures are synthesized once from each suite's scripted lines via OpenAI TTS
(a neutral user voice, not the character) and cached under
`evals/sonar/fixtures/` (gitignored, regenerable via `sonar synth`).

Tradeoff: synthetic input is clean studio audio, so VAD/STT run near
best-case — ideal for *reproducibly tracking the downstream stack's
progression*, optimistic for absolute STT realism. Drop a real recording at
a fixture's path to override; the loader doesn't care how the WAV was made.
That's the documented path to production-audio benchmarking.

`--turbo` streams STT frames as fast as possible. It measures STT *compute*
but collapses the real-time endpointing window, so its `voice-to-voice` is
**not representative** — smoke checks only.

## Endpointing suite (STT-only)

The `endpointing` suite measures turn detection on two axes a good endpointer
must win *together*:

- **endpoint latency** on complete utterances (`stt.endpoint-to-word`) — how
  fast it fires when the user is done;
- **cutoff rate** on *pause-aware* fixtures — utterances synthesized in parts
  rejoined with a >800ms silence gap (`{ parts: [...], gapMs }`). A
  fixed-silence endpointer fires mid-pause and the utterance comes back as
  **two** STT finals (`finals ≥ 2` → a cutoff); a semantic endpointer keeps
  it whole (`finals = 1`).

It's `sttOnly: true` — streams to audio-rt and skips the LLM/TTS legs, so it
needs **no admin cookie and no dev server**, only audio-rt. Point it at a
local instance with `--audio-rt-ws ws://localhost:…` to A/B a turn-detector
change. Baseline against the current 800ms-VAD audio-rt: **100% cutoff** —
that's what the semantic-endpointing work has to drive toward 0 while keeping
endpoint latency low.

### Real recordings (the fair cutoff eval)

Synthetic TTS pauses **understate** the cutoff benefit — a clip fragment like
"I was wondering" carries falsely-complete falling intonation a real
mid-sentence pause doesn't. The `real-endpointing` suite runs on real
recordings instead:

```bash
npm run sonar -- recordings --suite real-endpointing   # what to record, what's missing
# record each clip as a mono WAV → evals/sonar/recordings/<name>.wav, then:
npm run sonar -- run --suite real-endpointing --audio-rt-ws ws://127.0.0.1:8089/api/asr-streaming
```

A suite turn references real audio by name with explicit ground truth:
`{ recording: "pause-01", kind: "paused", script: "…" }`. Recordings load by
name (no hash juggling); a missing one fails with a pointed message. WAVs are
gitignored (your voice); the scripts live in the suite, so the eval is
reproducible by anyone who records the same lines. See
[`evals/sonar/recordings/README.md`](../../evals/sonar/recordings/README.md).

## Agency suite

The `agency-baseline` suite runs through the scene loop and exercises live
conversation control:

- correction / interruption at turn boundaries;
- low-information user engagement;
- initiative when the user does not know what to ask next;
- repair after a changed intent;
- scene/world drive rather than passive answer generation.

The current runner is sequential, so it does **not** yet measure true mid-agent
barge-in. That future suite needs overlapping audio: start user speech while
agent audio is still streaming, then score stop latency and recovery quality.

Agency is not inferred from latency. A fast reply can still fail to engage or
drive the scene. The judge command reads the local `.sonar/runs/` record,
scores the full transcript with a structured rubric, and upserts
`evals/sonar/agency-scores.jsonl` keyed by Sonar run id:

```bash
npm run sonar -- judge-agency --latest
npm run sonar -- judge-agency --run-id <run-prefix>
npm run sonar -- judge-agency --file .sonar/runs/<file>.json --dry-run
```

The joined benchmark reads that file and otherwise reports Agency as
`not judged`.

## Context Activation

Context Activation measures the content-management and knowledge-graph path:
can Sonar activate the right world context for a term or user prompt, do it
quickly enough for live voice, keep the cache hot, and avoid flooding the model
with too much context.

The first scorer is deterministic and reads the `serverTrace` already captured
in local run records. It uses:

- `server.retrieval.done`: semantic hit count and retrieval latency;
- `server.curator.done`: selected pages, token use, token budget, curator
  latency, and cache population;
- `server.context.attached`: injected wiki prompt size, selected pages, cache
  hits, retrieval skips, and context attachment latency.

Run the dedicated gold-label suite, then score it:

```bash
npm run sonar -- run --suite context-activation-baseline --label "context baseline"
npm run sonar -- score-context --latest
npm run sonar -- score-context --run-id <run-prefix>
npm run sonar -- score-context --file .sonar/runs/<file>.json --dry-run
```

The score is written to `evals/sonar/context-activation-scores.jsonl` and is
joined into `npm run benchmark -- report`. Current dimensions are:

| Dimension | Signal |
|---|---|
| `contextAvailability` | traced turns with attached context |
| `retrievalRecall` | expected page slugs selected for the turn; proxy only for unlabeled old traces |
| `retrievalPrecision` | selected pages that match expected slugs, minus forbidden-page drift |
| `curationSelectivity` | selected pages stay useful rather than broad |
| `tokenEfficiency` | curator stays within the context token budget |
| `cacheEffectiveness` | cache hit rate after the first turn in a session |
| `retrievalLatency` | retrieval p50, lower is better |
| `curatorLatency` | curator p50, lower is better |
| `contextAttachLatency` | request received → context attached p50, lower is better |

The dedicated suite is decision-grade for page activation because each turn
declares expected page slugs and must-not-inject slugs. Older runs without
`selectedPageSlugs` in their trace still score by proxy so historical rows
remain readable.

## Versioning

Two axes, both stamped on every run:

- **Sonar version** (`SONAR_VERSION`) — the methodology. Minor bump = span
  definitions or timing model changed = numbers stop being comparable; the
  report draws a break line. Patch = cosmetic.
- **The stack under test** — git SHA (+dirty flag), observed provider/model,
  and the run `--label` naming the change being tested.

Suites version independently: editing a suite's lines or session count bumps
the suite's own version.

## Storage

- Full run records (every turn, transcripts, raw traces) → `.sonar/runs/` —
  gitignored, machine-local, for post-hoc digging.
- Ledger → `evals/sonar/ledger.jsonl` — one compact line per run,
  **committed**, the durable progression history.

## Conventions

- Sessions run sequentially: audio-rt serializes STT and TTS behind global
  locks, so concurrency would measure contention, not the pipeline. A
  deliberate contention suite is future work.
- Sonar never forges auth — you pass a real admin cookie.
- Always pass `--label` when testing a change — the ledger is only as
  readable as its labels.
- Pass `--run-group <id>` (or set `ODYSSEY_RUN_GROUP`) across every suite in an
  experiment, then `npm run benchmark -- report --run-group <id>` to compare one
  exact experiment instead of nearest-matching-model runtime.
- Distributions over averages: read p50, p95, *and* p99 — and watch SLO
  attainment (`v2vSloPct`, share of turns under `--slo-ms`, default 1500ms),
  which is the goodput the percentiles can't show.
