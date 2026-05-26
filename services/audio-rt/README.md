# audio-rt

FastAPI gateway that wraps Kyutai STT (pytorch, lazy-loaded) and Kyutai
**Pocket TTS** (CPU-only, 100M params) behind a single HTTP+SSE service.
Deployed to Railway as `audio-rt-production`; consumed by the admin app
via `KYUTAI_BASE_URL` (STT) and `KYUTAI_TTS_BASE_URL` (TTS).

## Endpoints

- `GET /healthz` — service status, including STT/TTS load state and the
  voices currently cached in memory.
- `POST /transcribe` — body `{ audioBase64, mimeType }` → JSON `{ transcript, … }`.
  Decodes any browser-recorded format via ffmpeg, runs Kyutai STT.
- `POST /speak` — body `{ text, voice? }` → SSE stream of
  `meta` / `audio` (base64-encoded int16 PCM @ 24 kHz) / `done`/ `error`
  events.
- `POST /export-voice` — body `{ audioBase64, mimeType }` → raw
  `application/octet-stream` bytes of a Pocket TTS `.safetensors`
  embedding extracted from the reference clip. Called by the admin
  `/voices` surface; admin then uploads the bytes to the Supabase
  `voice-embeddings` bucket. Shells out to `pocket-tts export-voice`
  with `--language ${POCKET_TTS_LANGUAGE}` so the embedding matches the
  language pinned by `/speak`.

## Voices

Two sources, both addressed by slug from `POST /speak { voice }`:

1. **Baked into the image** — `.safetensors` files committed to
   [`voices/`](./voices). Used by legacy voices (`abraham`, `narrator`,
   `sarah`). Add a new one by running `pocket-tts export-voice
   path/to/clean_30s.wav voices/<slug>.safetensors`, committing the file,
   and pushing — Railway rebuilds.
2. **Managed via the admin `/voices` UI** — clip uploaded to the
   Supabase `voice-sources` bucket, `.safetensors` extracted via
   `POST /export-voice` on this service, stored in the `voice-embeddings`
   bucket. No redeploy needed. (See `apps/admin` `/voices` surface.)

Pocket TTS uses only the first 30s of the source clip. Run the source
through Adobe Podcast Enhance (or similar) first — the model reproduces
source artifacts.

## Model version pin

The TTS runtime pins `language="english_2026-01"` because the newer
`english_2026-04` has a known voice-cloning regression
([kyutai-labs/pocket-tts#175](https://github.com/kyutai-labs/pocket-tts/issues/175)).
Override with `POCKET_TTS_LANGUAGE` if upstream releases a fix.

## Required env

- `HF_TOKEN` — needed at container startup; `kyutai/pocket-tts` is gated.
  Set this on Railway as a service-level variable.

## Concurrency

Pocket TTS streaming state isn't documented as safe across concurrent
calls on the same `TTSModel` instance, so `PocketTtsRuntime._generate_lock`
serializes generation within a worker. Cross-session parallelism comes
from **uvicorn workers** — each worker is a separate Python process with
its own model, so concurrent `/speak` requests fan out across workers.

- `UVICORN_WORKERS` — number of worker processes. Defaults to `2` in the
  Dockerfile; set in Railway env to override. Memory cost ≈ 400MB per
  warmed worker (Pocket TTS + Whisper + Silero). Bump up if more than a
  couple of concurrent voice sessions are expected.
- `POCKET_TTS_FIRST_AUDIO_TIMEOUT_SECONDS` — `/speak` watchdog for a
  stalled Pocket generation before the first PCM frame. Defaults to `12`,
  below the admin client's default first-audio timeout so the service can
  emit a structured SSE `error` first.
- `POCKET_TTS_TOTAL_TIMEOUT_SECONDS` — `/speak` watchdog after audio has
  started. Defaults to `120`.
- `POCKET_TTS_RESTART_ON_STALL` — defaults to `1`. When a Pocket stream
  stalls, the endpoint emits an SSE `error` and exits that uvicorn worker;
  uvicorn's worker supervisor starts a clean replacement so the generation
  lock cannot stay wedged.

## Local dev

```bash
cd services/audio-rt
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0
uvicorn gateway:app --port 8765
```

`/healthz` will report `ttsRuntime.loaded: false` and `whisper.loaded: false`
until each background warm-up finishes downloading weights from HuggingFace
(~30–60s on a cold cache). Set `POCKET_TTS_WARM_ON_STARTUP=0` or
`WHISPER_WARM_ON_STARTUP=0` to skip the corresponding warm-up.

## Streaming STT (`/api/asr-streaming`)

WebSocket endpoint that the browser connects to via the audio-rt streaming
STT client in
[`apps/admin/src/lib/audio-rt-streaming-stt.ts`](../../apps/admin/src/lib/audio-rt-streaming-stt.ts).
Stack: faster-whisper (`base.en`, int8) for transcription + silero-vad
ONNX for end-of-speech detection. Protocol is msgpack — see the gateway's
inline docs in [`gateway.py`](./gateway.py) for the message types.
