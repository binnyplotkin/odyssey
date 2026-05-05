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

## Voices

`.safetensors` voice embeddings live in [`voices/`](./voices) and are baked
into the Docker image. To add a voice:

1. Locally: `pip install pocket-tts && hf auth login`
2. Run `pocket-tts export-voice path/to/clean_30s.wav voices/<name>.safetensors`
3. Commit the new `.safetensors` and push — Railway rebuilds and the new
   voice becomes available via `POST /speak { voice: "<name>" }`.

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

WebSocket endpoint that the browser connects to via `MOSHI_WS_URL` in
[`apps/admin/src/lib/moshi-client.ts`](../../apps/admin/src/lib/moshi-client.ts).
Stack: faster-whisper (`base.en`, int8) for transcription + silero-vad
ONNX for end-of-speech detection. Protocol is msgpack — see the gateway's
inline docs in [`gateway.py`](./gateway.py) for the message types.
