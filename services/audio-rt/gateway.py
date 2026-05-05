import base64
import itertools
import json
import math
import os
import subprocess
import tempfile
from threading import Lock
from typing import Iterator

import julius
import moshi.models
import numpy as np
import sphn
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="odyssey-audio-rt")

VOICES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices")
DEFAULT_VOICE_ID = "abraham"


class TranscribeRequest(BaseModel):
    audioBase64: str
    mimeType: str


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None


class KyutaiSttRuntime:
    def __init__(self) -> None:
        self._lock = Lock()
        self._transcribe_lock = Lock()
        self._loaded = False
        self._error: str | None = None
        self._mimi = None
        self._tokenizer = None
        self._lm_gen = None
        self._padding_token_id = 3
        self._audio_silence_prefix_seconds = 1.0
        self._audio_delay_seconds = 0.5
        self._device = "cpu"

    def _load(self) -> None:
        if self._loaded:
            return

        with self._lock:
            if self._loaded:
                return
            try:
                hf_repo = os.getenv("KYUTAI_STT_HF_REPO", "kyutai/stt-1b-en_fr")
                device = os.getenv("KYUTAI_STT_DEVICE", "cpu").strip().lower() or "cpu"
                if device == "cuda" and not torch.cuda.is_available():
                    device = "cpu"
                self._device = device

                info = moshi.models.loaders.CheckpointInfo.from_hf_repo(hf_repo)
                self._mimi = info.get_mimi(device=device)
                self._tokenizer = info.get_text_tokenizer()
                lm_dtype = torch.bfloat16 if device == "cuda" else torch.float32
                lm = info.get_moshi(device=device, dtype=lm_dtype)
                self._lm_gen = moshi.models.LMGen(lm, temp=0, temp_text=0.0)

                self._padding_token_id = info.raw_config.get("text_padding_token_id", 3)
                self._audio_silence_prefix_seconds = info.stt_config.get(
                    "audio_silence_prefix_seconds",
                    1.0,
                )
                # 1B model default delay is ~0.5s.
                self._audio_delay_seconds = info.stt_config.get("audio_delay_seconds", 0.5)
                self._loaded = True
                self._error = None
            except Exception as error:  # noqa: BLE001
                self._error = str(error)
                raise

    def status(self) -> dict[str, str | bool | None]:
        return {
            "loaded": self._loaded,
            "device": self._device,
            "error": self._error,
        }

    def transcribe_file(self, file_path: str) -> str:
        # Kyutai streaming contexts are single-session; concurrent requests must serialize.
        with self._transcribe_lock:
            self._load()
            assert self._mimi is not None
            assert self._tokenizer is not None
            assert self._lm_gen is not None

            audio, input_sample_rate = sphn.read(file_path)
            audio = torch.from_numpy(audio).to(self._device)
            if audio.ndim == 1:
                audio = audio.unsqueeze(0)
            elif audio.ndim > 1:
                audio = audio.mean(dim=0, keepdim=True)

            audio = julius.resample_frac(audio, input_sample_rate, self._mimi.sample_rate)
            if audio.shape[-1] % self._mimi.frame_size != 0:
                to_pad = self._mimi.frame_size - audio.shape[-1] % self._mimi.frame_size
                audio = torch.nn.functional.pad(audio, (0, to_pad))

            n_prefix_chunks = math.ceil(self._audio_silence_prefix_seconds * self._mimi.frame_rate)
            n_suffix_chunks = math.ceil(self._audio_delay_seconds * self._mimi.frame_rate)
            silence_chunk = torch.zeros(
                (1, 1, self._mimi.frame_size),
                dtype=torch.float32,
                device=self._device,
            )

            chunks = itertools.chain(
                itertools.repeat(silence_chunk, n_prefix_chunks),
                torch.split(audio[:, None], self._mimi.frame_size, dim=-1),
                itertools.repeat(silence_chunk, n_suffix_chunks),
            )

            text_tokens_accum = []
            with self._mimi.streaming(1), self._lm_gen.streaming(1):
                for audio_chunk in chunks:
                    audio_tokens = self._mimi.encode(audio_chunk)
                    text_tokens = self._lm_gen.step(audio_tokens)
                    if text_tokens is not None:
                        text_tokens_accum.append(text_tokens)

            if not text_tokens_accum:
                return ""

            utterance_tokens = torch.concat(text_tokens_accum, dim=-1)
            text_tokens = utterance_tokens.cpu().view(-1)
            transcript = self._tokenizer.decode(
                text_tokens[text_tokens > self._padding_token_id].numpy().tolist(),
            )
            return transcript.strip()


stt_runtime = KyutaiSttRuntime()


class PocketTtsRuntime:
    """Wraps Pocket TTS (Kyutai 100M, CPU-only) with lazy load + per-voice cache.

    Pinned to language="english_2026-01" because english_2026-04 has a known
    voice-cloning regression (kyutai-labs/pocket-tts#175). Voices live as
    .safetensors files in services/audio-rt/voices/ and are baked into the
    image at build time.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._generate_lock = Lock()
        self._loaded = False
        self._error: str | None = None
        self._model = None
        self._sample_rate: int | None = None
        self._voice_states: dict[str, object] = {}

    def _load(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            try:
                from pocket_tts import TTSModel

                language = os.getenv("POCKET_TTS_LANGUAGE", "english_2026-01")
                steps = int(os.getenv("POCKET_TTS_LSD_DECODE_STEPS", "5"))
                temp = float(os.getenv("POCKET_TTS_TEMP", "0.5"))
                self._model = TTSModel.load_model(
                    language=language,
                    lsd_decode_steps=steps,
                    temp=temp,
                )
                self._sample_rate = self._model.sample_rate
                self._loaded = True
                self._error = None
            except Exception as error:
                self._error = str(error)
                raise

    def _voice_path(self, voice_id: str) -> str:
        # Voice IDs are simple slugs like "abraham"; reject anything that could
        # escape the voices/ dir.
        if not voice_id or "/" in voice_id or ".." in voice_id:
            raise HTTPException(status_code=400, detail=f"Invalid voice id: {voice_id!r}")
        path = os.path.join(VOICES_DIR, f"{voice_id}.safetensors")
        if not os.path.isfile(path):
            raise HTTPException(status_code=404, detail=f"Voice not found: {voice_id}")
        return path

    def _get_voice_state(self, voice_id: str):
        if voice_id in self._voice_states:
            return self._voice_states[voice_id]
        with self._lock:
            if voice_id in self._voice_states:
                return self._voice_states[voice_id]
            self._load()
            assert self._model is not None
            state = self._model.get_state_for_audio_prompt(self._voice_path(voice_id))
            self._voice_states[voice_id] = state
            return state

    def status(self) -> dict[str, object]:
        return {
            "loaded": self._loaded,
            "sampleRate": self._sample_rate,
            "voicesCached": list(self._voice_states.keys()),
            "voicesAvailable": sorted(
                f.removesuffix(".safetensors")
                for f in os.listdir(VOICES_DIR)
                if f.endswith(".safetensors")
            )
            if os.path.isdir(VOICES_DIR)
            else [],
            "error": self._error,
        }

    def stream_pcm_chunks(self, text: str, voice_id: str) -> Iterator[bytes]:
        """Yield raw int16-LE PCM bytes per generated frame.

        Pocket TTS yields one ~80ms torch tensor per step; we convert each to
        24kHz mono int16 little-endian (matches the existing Moshi TTS wire
        format consumed by apps/admin/src/lib/moshi-client.ts).
        """
        # Single-stream guard: pocket-tts streaming state isn't documented as
        # safe across concurrent calls on the same model instance, so serialize.
        with self._generate_lock:
            self._load()
            assert self._model is not None
            voice_state = self._get_voice_state(voice_id)
            for chunk in self._model.generate_audio_stream(voice_state, text):
                arr = chunk.detach().cpu().numpy() if hasattr(chunk, "detach") else np.asarray(chunk)
                arr = np.clip(arr, -1.0, 1.0)
                pcm = (arr * 32767.0).astype(np.int16).tobytes()
                yield pcm


tts_runtime = PocketTtsRuntime()


@app.on_event("startup")
def _warm_tts_on_startup() -> None:
    """Block container startup on TTS readiness so Railway's healthcheck only
    flips green once /speak can serve a request immediately. Toggle off with
    POCKET_TTS_WARM_ON_STARTUP=0 (e.g. for fast iteration in local dev)."""
    if os.getenv("POCKET_TTS_WARM_ON_STARTUP", "1") != "1":
        return
    voice_id = os.getenv("POCKET_TTS_DEFAULT_VOICE", DEFAULT_VOICE_ID)
    try:
        tts_runtime._load()
        tts_runtime._get_voice_state(voice_id)
    except Exception as error:  # noqa: BLE001
        # Log and continue — /healthz will surface the error and /speak will
        # retry the load on the next request rather than killing the container.
        print(f"[startup] Pocket TTS warm-up failed: {error}", flush=True)


def _extension_from_mime(mime_type: str) -> str:
    normalized = (mime_type or "").split(";")[0].strip().lower()
    mapping = {
        "audio/webm": ".webm",
        "audio/mp4": ".mp4",
        "audio/m4a": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/ogg": ".ogg",
        "audio/flac": ".flac",
        "audio/aac": ".aac",
    }
    return mapping.get(normalized, ".webm")


def _decode_source_to_wav(source_path: str, wav_path: str) -> tuple[bool, str]:
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-ac",
            "1",
            wav_path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0, result.stderr.strip() or "ffmpeg failed."


def _candidate_extensions(mime_type: str) -> list[str]:
    preferred = _extension_from_mime(mime_type)
    normalized = (mime_type or "").split(";")[0].strip().lower()
    candidates = [preferred]

    # Some browser recorder paths mislabel container types intermittently.
    if normalized in {"audio/mp4", "audio/m4a", "audio/aac"}:
        candidates.extend([".webm", ".ogg"])
    elif normalized in {"audio/webm", "audio/ogg"}:
        candidates.extend([".mp4", ".m4a"])
    else:
        candidates.extend([".webm", ".mp4", ".m4a", ".ogg", ".wav"])

    deduped: list[str] = []
    for ext in candidates:
        if ext not in deduped:
            deduped.append(ext)
    return deduped


def _decode_to_wav_bytes(audio_base64: str, mime_type: str) -> bytes:
    try:
        raw = base64.b64decode(audio_base64, validate=True)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid audioBase64 payload: {error}") from error

    with tempfile.TemporaryDirectory() as temp_dir:
        wav_path = os.path.join(temp_dir, "input.wav")

        last_error = "ffmpeg failed."
        decoded = False
        for ext in _candidate_extensions(mime_type):
            source_path = os.path.join(temp_dir, f"input{ext}")
            with open(source_path, "wb") as source_file:
                source_file.write(raw)

            ok, stderr = _decode_source_to_wav(source_path, wav_path)
            if ok:
                decoded = True
                break
            last_error = stderr

        if not decoded:
            raise HTTPException(
                status_code=400,
                detail=f"Could not decode audio input: {last_error}",
            )

        with open(wav_path, "rb") as wav_file:
            return wav_file.read()


@app.get("/healthz")
def healthz():
    return {
        "ok": True,
        "service": "audio-rt",
        "provider": "kyutai",
        "mode": "stt+tts",
        "sttRuntime": stt_runtime.status(),
        "ttsRuntime": tts_runtime.status(),
    }


@app.post("/transcribe")
def transcribe(payload: TranscribeRequest):
    wav_bytes = _decode_to_wav_bytes(payload.audioBase64, payload.mimeType)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
        temp_file.write(wav_bytes)
        temp_path = temp_file.name

    try:
        transcript = stt_runtime.transcribe_file(temp_path)
        return {
            "transcript": transcript,
            "provider": "kyutai",
            "model": os.getenv("KYUTAI_STT_HF_REPO", "kyutai/stt-1b-en_fr"),
        }
    except HTTPException:
        raise
    except Exception as error:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Kyutai STT failed: {error}",
        ) from error
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


@app.post("/speak")
def speak(payload: SpeakRequest):
    """Stream synthesized speech as Server-Sent Events.

    Event types:
      - "meta"  → {"sampleRate": 24000, "channels": 1, "encoding": "pcm_s16le"}
      - "audio" → {"chunk": <base64-encoded int16-LE PCM>, "index": <int>}
      - "done"  → {"chunks": <int>}
      - "error" → {"message": <str>}
    """
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    voice_id = payload.voice or DEFAULT_VOICE_ID

    # Trigger lazy load up front so we can return a synchronous 5xx if model
    # download / voice load fails, instead of a half-streamed response.
    try:
        tts_runtime._load()
        tts_runtime._get_voice_state(voice_id)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Pocket TTS init failed: {error}") from error

    def sse_event(event: str, data: dict) -> bytes:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")

    def event_stream():
        try:
            yield sse_event("meta", {
                "sampleRate": tts_runtime._sample_rate,
                "channels": 1,
                "encoding": "pcm_s16le",
                "voice": voice_id,
            })
            index = 0
            for pcm in tts_runtime.stream_pcm_chunks(text, voice_id):
                yield sse_event("audio", {
                    "index": index,
                    "chunk": base64.b64encode(pcm).decode("ascii"),
                })
                index += 1
            yield sse_event("done", {"chunks": index})
        except Exception as error:  # noqa: BLE001
            yield sse_event("error", {"message": str(error)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
