# Odyssey Sonar

Versioned **voice-to-voice** latency benchmark harness for the Odyssey
pipeline. A sonar ping is a latency measurement: emit a pulse, time the
echo. Every Sonar turn starts from *spoken audio* — a synthesized user
utterance streamed into the audio-rt STT WebSocket at real-time pace — runs
through the real admin routes (STT → optional orchestrator → voice-stream),
and is timed to the agent's first audio. Text-initiated turns don't exist
here: they'd hide the two biggest real costs (VAD endpointing + STT), and
Odyssey is voice-first.

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

**One deliberate exclusion:** `voice-to-voice` is *pipeline-intrinsic* — it
omits the 1500ms client commit hold (`STREAMING_COMMIT_HOLD_MS`) that the
production sandbox currently waits after STT finalizes before sending the
turn. That hold is a knob we plan to cut; excluding it keeps Sonar measuring
the pipeline we're optimizing, and once the hold is gone the production
number converges to Sonar's. (Add it back mentally: real felt latency today
≈ `voice-to-voice` + ~1500ms.)

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
- Distributions over averages: read p50 *and* p95.
