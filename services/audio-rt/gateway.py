import asyncio
import base64
import hashlib
import itertools
import json
import math
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
from threading import Lock
from typing import Iterator

import julius
import moshi.models
import msgpack
import numpy as np
import sphn
import torch
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="odyssey-audio-rt")

VOICES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices")
# Cache dir for .safetensors files downloaded from Supabase signed URLs.
# Lives under VOICES_DIR so it shares the same volume mount; files are keyed
# by a short hash of the signed URL so a re-extracted voice gets a fresh
# entry without manual eviction.
REMOTE_VOICES_DIR = os.path.join(VOICES_DIR, "_remote")
os.makedirs(REMOTE_VOICES_DIR, exist_ok=True)
DEFAULT_VOICE_ID = "abraham"
DEFAULT_TTS_FIRST_AUDIO_TIMEOUT_SECONDS = 12.0
DEFAULT_TTS_TOTAL_TIMEOUT_SECONDS = 120.0


class TranscribeRequest(BaseModel):
    audioBase64: str
    mimeType: str


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None
    # Optional signed URL to a .safetensors voice embedding stored in
    # Supabase. When provided AND the voice slug is not present in the
    # baked-in voices/ dir, audio-rt fetches the file once, caches it
    # under voices/_remote/, and uses it. Admin's /api/voices flow sets
    # this; legacy callers that only know the slug keep working unchanged.
    voiceUrl: str | None = None


class ExportVoiceRequest(BaseModel):
    audioBase64: str
    mimeType: str


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

    def _voice_path(self, voice_id: str, voice_url: str | None = None) -> str:
        # Voice IDs are simple slugs like "abraham"; reject anything that could
        # escape the voices/ dir.
        if not voice_id or "/" in voice_id or ".." in voice_id:
            raise HTTPException(status_code=400, detail=f"Invalid voice id: {voice_id!r}")
        baked = os.path.join(VOICES_DIR, f"{voice_id}.safetensors")
        if os.path.isfile(baked):
            return baked
        if voice_url:
            return self._ensure_remote_voice(voice_id, voice_url)
        raise HTTPException(status_code=404, detail=f"Voice not found: {voice_id}")

    def _ensure_remote_voice(self, voice_id: str, voice_url: str) -> str:
        """Download a Supabase-hosted .safetensors to the local cache.

        Keyed by a short hash of the URL so re-extracted voices (which
        rotate the signed-URL token) skip stale cache entries naturally.
        """
        url_hash = hashlib.sha256(voice_url.encode("utf-8")).hexdigest()[:16]
        cache_path = os.path.join(REMOTE_VOICES_DIR, f"{voice_id}.{url_hash}.safetensors")
        if os.path.isfile(cache_path):
            return cache_path
        tmp_path = f"{cache_path}.tmp"
        try:
            with urllib.request.urlopen(voice_url, timeout=30) as response:
                if response.status != 200:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Voice fetch failed (HTTP {response.status}) for {voice_id}",
                    )
                with open(tmp_path, "wb") as out:
                    shutil.copyfileobj(response, out)
            os.replace(tmp_path, cache_path)
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(
                status_code=502,
                detail=f"Voice fetch failed for {voice_id}: {error}",
            ) from error
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
        return cache_path

    def _state_key(self, voice_id: str, voice_url: str | None) -> str:
        if not voice_url:
            return voice_id
        url_hash = hashlib.sha256(voice_url.encode("utf-8")).hexdigest()[:16]
        return f"{voice_id}@{url_hash}"

    def _get_voice_state(self, voice_id: str, voice_url: str | None = None):
        key = self._state_key(voice_id, voice_url)
        if key in self._voice_states:
            return self._voice_states[key]
        with self._lock:
            if key in self._voice_states:
                return self._voice_states[key]
            self._load()
            assert self._model is not None
            state = self._model.get_state_for_audio_prompt(
                self._voice_path(voice_id, voice_url),
            )
            self._voice_states[key] = state
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

    def stream_pcm_chunks(
        self,
        text: str,
        voice_id: str,
        voice_url: str | None = None,
    ) -> Iterator[bytes]:
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
            voice_state = self._get_voice_state(voice_id, voice_url)
            for chunk in self._model.generate_audio_stream(voice_state, text):
                arr = chunk.detach().cpu().numpy() if hasattr(chunk, "detach") else np.asarray(chunk)
                arr = np.clip(arr, -1.0, 1.0)
                pcm = (arr * 32767.0).astype(np.int16).tobytes()
                yield pcm


tts_runtime = PocketTtsRuntime()


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw not in {"0", "false", "no", "off"}


def _schedule_worker_restart(reason: str) -> None:
    if not _env_bool("POCKET_TTS_RESTART_ON_STALL", True):
        return

    delay = _env_float("POCKET_TTS_RESTART_DELAY_SECONDS", 1.0)

    def restart() -> None:
        time.sleep(delay)
        print(f"[pocket-tts] restarting worker after stalled generation: {reason}", flush=True)
        os._exit(75)

    threading.Thread(
        target=restart,
        name="pocket-tts-stall-restart",
        daemon=True,
    ).start()


class WhisperStreamingRuntime:
    """Wraps faster-whisper (CTranslate2 backend) for utterance-mode CPU STT.

    Exposes one transcribe-utterance call per VAD-detected end-of-speech.
    Default model `base.en` matched Kyutai STT 1B word-for-word in spike,
    with ~25x RTF on a Mac CPU and 5–8x on a Railway container.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._loaded = False
        self._error: str | None = None
        self._model = None

    def _load(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            try:
                from faster_whisper import WhisperModel

                model_name = os.getenv("WHISPER_MODEL", "base.en")
                threads = int(os.getenv("WHISPER_THREADS", "4"))
                compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
                self._model = WhisperModel(
                    model_name,
                    device="cpu",
                    cpu_threads=threads,
                    compute_type=compute_type,
                )
                self._loaded = True
                self._error = None
            except Exception as error:
                self._error = str(error)
                raise

    def status(self) -> dict[str, object]:
        return {
            "loaded": self._loaded,
            "model": os.getenv("WHISPER_MODEL", "base.en"),
            "computeType": os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
            "error": self._error,
        }

    def transcribe_utterance(self, audio_16khz: np.ndarray) -> list[tuple[str, float]]:
        """Transcribe a complete utterance buffer at 16kHz mono Float32.

        Returns list of (word_text, start_time_s). The start_time_s is
        relative to the utterance start, NOT the connection start; the
        WebSocket handler rebases timestamps if needed for telemetry.
        """
        self._load()
        assert self._model is not None
        segments, _info = self._model.transcribe(
            audio_16khz,
            language="en",
            vad_filter=False,  # we VAD upstream with silero
            word_timestamps=True,
            beam_size=1,  # greedy for lowest latency; voice-agent text is short
        )
        words: list[tuple[str, float]] = []
        for seg in segments:
            seg_words = getattr(seg, "words", None)
            if seg_words:
                for w in seg_words:
                    text = (w.word or "").strip()
                    if text:
                        words.append((text, float(w.start)))
            else:
                for word_text in (seg.text or "").strip().split():
                    if word_text:
                        words.append((word_text, float(seg.start)))
        return words


whisper_runtime = WhisperStreamingRuntime()


class SileroVadRuntime:
    """Wraps silero-vad ONNX backend. Stateful per-utterance, so we hand out
    a fresh instance per WebSocket connection rather than sharing one model.

    The `silero_vad.load_silero_vad(onnx=True)` factory is lightweight (~150ms
    on cold cache) and the model itself is ~1.8MB. The shared `_load()` here
    just primes the global ONNX runtime so per-connection construction is
    fast — the actual model object handed to each connection is fresh.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._primed = False
        self._error: str | None = None

    def _prime(self) -> None:
        if self._primed:
            return
        with self._lock:
            if self._primed:
                return
            try:
                from silero_vad import load_silero_vad
                # Build one throwaway to trigger ONNX runtime + weights download.
                _ = load_silero_vad(onnx=True)
                self._primed = True
                self._error = None
            except Exception as error:
                self._error = str(error)
                raise

    def fresh_model(self):
        self._prime()
        from silero_vad import load_silero_vad
        return load_silero_vad(onnx=True)

    def status(self) -> dict[str, object]:
        return {"primed": self._primed, "error": self._error}


vad_runtime = SileroVadRuntime()


@app.on_event("startup")
def _warm_tts_on_startup() -> None:
    """Warm Pocket TTS in a background thread so the container binds the port
    immediately and Railway's healthcheck passes. The first /speak call will
    block on the same lock if the warmup is still in flight. /healthz reports
    the live load state. Toggle off with POCKET_TTS_WARM_ON_STARTUP=0."""
    voice_id = os.getenv("POCKET_TTS_DEFAULT_VOICE", DEFAULT_VOICE_ID)
    warm_tts = os.getenv("POCKET_TTS_WARM_ON_STARTUP", "1") == "1"
    warm_stt = os.getenv("WHISPER_WARM_ON_STARTUP", "1") == "1"
    if not warm_tts and not warm_stt:
        return

    # Warm TTS and STT in independent daemon threads so a stalled HF download
    # in one path can't block the other. Whichever finishes first becomes
    # available; /healthz reports each runtime's load state independently.

    def _warm_tts():
        print(f"[startup] Pocket TTS warm-up starting (voice={voice_id})...", flush=True)
        t0 = time.time()
        try:
            tts_runtime._load()
            tts_runtime._get_voice_state(voice_id)
            # Drive a tiny synthesis through the inference path so the first
            # real user request doesn't pay for graph init / mimi codec
            # setup / first-call CT2 compile. Warmup output is discarded.
            t_synth = time.time()
            for _ in tts_runtime.stream_pcm_chunks("hello.", voice_id):
                pass
            print(
                f"[startup] Pocket TTS warm-up complete in {time.time()-t0:.1f}s "
                f"(synth pass {time.time()-t_synth:.2f}s).",
                flush=True,
            )
        except Exception as error:  # noqa: BLE001
            print(f"[startup] Pocket TTS warm-up failed after {time.time()-t0:.1f}s: {error}", flush=True)

    def _warm_stt():
        print("[startup] faster-whisper + silero warm-up starting...", flush=True)
        t0 = time.time()
        try:
            whisper_runtime._load()
            vad_runtime._prime()
            # Drive one tiny inference so CTranslate2 finishes any JIT-style
            # setup and the first real request is faster.
            whisper_runtime.transcribe_utterance(np.zeros(16000, dtype=np.float32))
            if SMART_TURN_ENABLED:
                p = smart_turn.warm()
                print(f"[startup] Smart Turn v3 warm-up complete (sanity P={p:.3f}).", flush=True)
            print(f"[startup] faster-whisper + silero warm-up complete in {time.time()-t0:.1f}s.", flush=True)
        except Exception as error:  # noqa: BLE001
            print(f"[startup] STT warm-up failed after {time.time()-t0:.1f}s: {error}", flush=True)

    if warm_tts:
        threading.Thread(target=_warm_tts, name="audio-rt-warmup-tts", daemon=True).start()
    if warm_stt:
        threading.Thread(target=_warm_stt, name="audio-rt-warmup-stt", daemon=True).start()


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
    # Output is pinned to 24kHz mono int16-LE PCM — what Pocket TTS expects
    # natively and what the Kyutai STT 1B path runs against. Without -ar
    # and -acodec, ffmpeg keeps whatever sample rate the input had (e.g.
    # 44.1kHz from a typical mp3), forcing Pocket TTS to resample internally;
    # that resample step is a known fragile path on some clips.
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-ar",
            "24000",
            "-ac",
            "1",
            "-acodec",
            "pcm_s16le",
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


def _smart_turn_health() -> dict[str, object]:
    """Report semantic-endpointing state for /healthz. The silent failure mode
    is SMART_TURN_ENABLED=1 set but the model never loaded (warm-up faulted →
    per-connection fallback to fixed silence), so report `loaded`, not just the
    env flag. SMART_TURN_* are defined later in the module but resolved here at
    request time, and `smart_turn` is only imported when the flag is on."""
    if not SMART_TURN_ENABLED:
        return {"enabled": False}
    return {
        "enabled": True,
        "loaded": smart_turn.is_loaded(),
        "threshold": SMART_TURN_THRESHOLD,
    }


@app.get("/healthz")
def healthz():
    return {
        "ok": True,
        "service": "audio-rt",
        "provider": "kyutai+whisper",
        "mode": "stt+tts+streaming-stt",
        "sttRuntime": stt_runtime.status(),
        "ttsRuntime": tts_runtime.status(),
        "streamingSttRuntime": {
            "whisper": whisper_runtime.status(),
            "vad": vad_runtime.status(),
            "smartTurn": _smart_turn_health(),
        },
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
      - "meta"  → {"sampleRate": 24000, "channels": 1, "encoding": "pcm_s16le",
                   "voice": <id>, "elapsedMs": <handler entry → first yield>}
      - "audio" → {"chunk": <base64-encoded int16-LE PCM>, "index": <int>}
      - "done"  → {"chunks": <int>, "totalMs": <handler entry → done>,
                   "firstAudioMs": <handler entry → first audio chunk>}
      - "error" → {"message": <str>}
    """
    handler_entered_at = time.time()
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    voice_id = payload.voice or DEFAULT_VOICE_ID
    voice_url = payload.voiceUrl

    # Trigger lazy load up front so we can return a synchronous 5xx if model
    # download / voice load fails, instead of a half-streamed response.
    try:
        tts_runtime._load()
        tts_runtime._get_voice_state(voice_id, voice_url)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Pocket TTS init failed: {error}") from error

    setup_done_at = time.time()

    def sse_event(event: str, data: dict) -> bytes:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")

    def event_stream():
        first_chunk_at: float | None = None
        first_audio_timeout = _env_float(
            "POCKET_TTS_FIRST_AUDIO_TIMEOUT_SECONDS",
            DEFAULT_TTS_FIRST_AUDIO_TIMEOUT_SECONDS,
        )
        total_timeout = _env_float(
            "POCKET_TTS_TOTAL_TIMEOUT_SECONDS",
            DEFAULT_TTS_TOTAL_TIMEOUT_SECONDS,
        )
        chunks: queue.Queue[tuple[str, bytes | Exception | None]] = queue.Queue()
        state_lock = Lock()
        state = {
            "chunks": 0,
            "done": False,
            "firstAudioAt": None,
            "timeout": None,
        }

        def mark_done() -> None:
            with state_lock:
                state["done"] = True

        def mark_timeout(message: str) -> bool:
            with state_lock:
                if state["done"] or state["timeout"]:
                    return False
                state["timeout"] = message
            print(f"[/speak] {message}", flush=True)
            chunks.put(("error", RuntimeError(message)))
            _schedule_worker_restart(message)
            return True

        def monitor_generation() -> None:
            while True:
                time.sleep(0.25)
                elapsed = time.time() - handler_entered_at
                with state_lock:
                    if state["done"] or state["timeout"]:
                        return
                    first_audio_at = state["firstAudioAt"]
                    generated_chunks = int(state["chunks"])

                if first_audio_at is None and elapsed >= first_audio_timeout:
                    mark_timeout(
                        f"Pocket TTS first audio timed out after "
                        f"{int(elapsed * 1000)}ms "
                        f"(voice={voice_id}, chars={len(text)}, chunks={generated_chunks})",
                    )
                    return

                if first_audio_at is not None and elapsed >= total_timeout:
                    mark_timeout(
                        f"Pocket TTS total generation timed out after "
                        f"{int(elapsed * 1000)}ms "
                        f"(voice={voice_id}, chars={len(text)}, chunks={generated_chunks})",
                    )
                    return

        def generate() -> None:
            try:
                for pcm in tts_runtime.stream_pcm_chunks(text, voice_id, voice_url):
                    chunks.put(("audio", pcm))
                chunks.put(("done", None))
            except Exception as error:  # noqa: BLE001
                chunks.put(("error", error))
            finally:
                with state_lock:
                    if state["timeout"] is None:
                        state["done"] = True

        threading.Thread(
            target=generate,
            name=f"pocket-tts-generate-{voice_id}",
            daemon=True,
        ).start()
        threading.Thread(
            target=monitor_generation,
            name=f"pocket-tts-watchdog-{voice_id}",
            daemon=True,
        ).start()

        try:
            yield sse_event("meta", {
                "sampleRate": tts_runtime._sample_rate,
                "channels": 1,
                "encoding": "pcm_s16le",
                "voice": voice_id,
                "elapsedMs": int((setup_done_at - handler_entered_at) * 1000),
            })
            index = 0
            while True:
                try:
                    kind, value = chunks.get(timeout=1.0)
                except queue.Empty:
                    continue

                if kind == "done":
                    mark_done()
                    break
                if kind == "error":
                    mark_done()
                    raise value if isinstance(value, Exception) else RuntimeError(str(value))

                pcm = value
                if not isinstance(pcm, bytes):
                    raise RuntimeError("Pocket TTS returned a non-bytes audio chunk")
                if first_chunk_at is None:
                    first_chunk_at = time.time()
                    with state_lock:
                        state["firstAudioAt"] = first_chunk_at
                with state_lock:
                    state["chunks"] = index + 1
                yield sse_event("audio", {
                    "index": index,
                    "chunk": base64.b64encode(pcm).decode("ascii"),
                })
                index += 1
            done_at = time.time()
            print(
                f"[/speak] voice={voice_id} chars={len(text)} chunks={index} "
                f"setup_ms={int((setup_done_at - handler_entered_at) * 1000)} "
                f"first_audio_ms={int(((first_chunk_at or done_at) - handler_entered_at) * 1000)} "
                f"total_ms={int((done_at - handler_entered_at) * 1000)}",
                flush=True,
            )
            yield sse_event("done", {
                "chunks": index,
                "totalMs": int((done_at - handler_entered_at) * 1000),
                "firstAudioMs": int(((first_chunk_at or done_at) - handler_entered_at) * 1000),
            })
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


@app.post("/export-voice")
def export_voice(payload: ExportVoiceRequest):
    """Extract a Pocket TTS voice embedding from a reference clip.

    Accepts the same {audioBase64, mimeType} shape as /transcribe so the
    admin can pipe any browser-recorded format through. Decodes to WAV via
    ffmpeg, then shells out to `pocket-tts export-voice` (the documented
    stable CLI) to produce a .safetensors blob, and returns those raw
    bytes. The admin uploads them to Supabase Storage and points the
    voices row at the resulting path.

    Pocket TTS truncates the audio to its first 30s internally.
    """
    handler_entered_at = time.time()
    wav_bytes = _decode_to_wav_bytes(payload.audioBase64, payload.mimeType)

    with tempfile.TemporaryDirectory() as temp_dir:
        wav_path = os.path.join(temp_dir, "input.wav")
        out_path = os.path.join(temp_dir, "out.safetensors")
        with open(wav_path, "wb") as wav_file:
            wav_file.write(wav_bytes)

        language = os.getenv("POCKET_TTS_LANGUAGE", "english_2026-01")
        cmd = [
            "pocket-tts",
            "export-voice",
            "--language",
            language,
            "--quiet",
            wav_path,
            out_path,
        ]
        try:
            result = subprocess.run(
                cmd,
                check=False,
                capture_output=True,
                text=True,
                timeout=180,
            )
        except FileNotFoundError as error:
            raise HTTPException(
                status_code=500,
                detail=f"pocket-tts CLI not found on PATH: {error}",
            ) from error
        except subprocess.TimeoutExpired as error:
            raise HTTPException(
                status_code=504,
                detail="pocket-tts export-voice timed out after 180s",
            ) from error

        if result.returncode != 0 or not os.path.isfile(out_path):
            full_err = (result.stderr or result.stdout).strip()
            # Print the full traceback to stdout so it's visible in Railway
            # logs — the HTTP response body has length limits and Rich-format
            # banners can blow past them without ever showing the actual
            # exception line.
            print(
                f"[/export-voice] FAILED exit={result.returncode}\n{full_err}",
                flush=True,
            )
            # Return the *tail* of stderr to the client (Rich tracebacks put
            # the exception type and message at the bottom, which is what's
            # actually load-bearing for debugging).
            raise HTTPException(
                status_code=500,
                detail=f"pocket-tts export-voice failed (exit {result.returncode}): "
                f"{full_err[-2000:]}",
            )

        with open(out_path, "rb") as out_file:
            embedding_bytes = out_file.read()

    elapsed_ms = int((time.time() - handler_entered_at) * 1000)
    print(
        f"[/export-voice] bytes_in={len(wav_bytes)} bytes_out={len(embedding_bytes)} "
        f"total_ms={elapsed_ms}",
        flush=True,
    )
    return StreamingResponse(
        iter([embedding_bytes]),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(len(embedding_bytes)),
            "X-Elapsed-Ms": str(elapsed_ms),
        },
    )


# ── Streaming STT WebSocket ─────────────────────────────────────────
#
# Protocol is the browser audio-rt streaming STT contract used by
# apps/admin/src/lib/audio-rt-streaming-stt.ts. It remains msgpack-compatible
# with the older Moshi-era client while the legacy debug surfaces migrate.
#
#   client → server (msgpack frames):
#     { type: "Audio", pcm: Float32[1920] }   # 80 ms @ 24 kHz mono
#
#   server → client (msgpack frames):
#     { type: "Ready" }                         # once on connect
#     { type: "Step", step_idx: int, prs: float[4] }  # ~every 32 ms; prs[2] is pause prob
#     { type: "Word", text: str, start_time: float }  # one per recognized word
#     { type: "Error", message: str }                 # on fault
#
# Audio handling per WebSocket connection:
#   1. Resample 24 kHz → 16 kHz (1280 samples per inbound frame).
#   2. Feed to silero-vad in 512-sample (32 ms) chunks; stash leftovers.
#   3. While speech_prob > VAD_ON, append to the utterance buffer.
#   4. When silence runs ≥ END_OF_SPEECH_SILENCE_CHUNKS, drain the buffer
#      through faster-whisper and emit one Word frame per recognized word.
#
# faster-whisper.transcribe() is synchronous and blocks ~150–500 ms per
# utterance — we run it via asyncio.to_thread so the WebSocket recv loop
# keeps draining frames while transcription is in flight.

STT_INPUT_SR = 24000
STT_INTERNAL_SR = 16000
STT_INPUT_FRAME = 1920          # 80 ms @ 24 kHz
SILERO_CHUNK = 512              # silero v5+ only accepts 512 @ 16 kHz
VAD_ON_THRESHOLD = 0.5
VAD_OFF_THRESHOLD = 0.35        # hysteresis to avoid mid-word flicker
END_OF_SPEECH_SILENCE_CHUNKS = 25   # 25 × 32 ms = 800 ms of silence
MIN_UTTERANCE_CHUNKS = 6        # ~192 ms; drops single-word noise blips
MAX_UTTERANCE_SAMPLES = STT_INTERNAL_SR * 30  # 30 s hard cap
LOOKBACK_CHUNKS = 4             # ~128 ms pre-roll; catches the leading
                                # phoneme of a word VAD detects one chunk
                                # late (otherwise "I live" → "live").

# ── Smart Turn v3 (optional semantic endpointing) ────────────────────
# When enabled, silero still detects the pause but Smart Turn decides whether
# the turn is actually over: fire fast on a complete utterance, keep listening
# through a mid-sentence pause. Default off — behaviour is unchanged and the
# transformers dep isn't loaded unless SMART_TURN_ENABLED=1.
SMART_TURN_ENABLED = os.getenv("SMART_TURN_ENABLED", "0") == "1"
# Check turn-completion once this much trailing silence has accrued (~448 ms) —
# shorter than the 800 ms fixed window so complete turns end sooner, but long
# enough to skip brief internal pauses (commas) so a complete clause like
# "Peace be with you, friend" isn't split at the comma.
SMART_TURN_SILENCE_CHUNKS = int(os.getenv("SMART_TURN_SILENCE_CHUNKS", "14"))
# Force end-of-turn at this much silence even if Smart Turn still says
# "incomplete" — safety net so a trailing-off utterance can't hang (~2 s).
SMART_TURN_MAX_SILENCE_CHUNKS = int(os.getenv("SMART_TURN_MAX_SILENCE_CHUNKS", "63"))
# P(complete) at/above which the turn ends. The model is calibrated for 0.5;
# raise it to be more reluctant to cut (fewer mid-sentence cutoffs, slightly
# higher latency on genuinely-complete turns).
SMART_TURN_THRESHOLD = float(os.getenv("SMART_TURN_THRESHOLD", "0.5"))
# Trailing silence is itself a completion cue, so a long pause biases the
# model toward "complete" and cuts mid-sentence. Trim the accruing silence
# down to this fixed pad (~96ms) before inference so the verdict depends on
# the speech prosody, not how long the pause has run.
SMART_TURN_PAD_CHUNKS = int(os.getenv("SMART_TURN_PAD_CHUNKS", "3"))

if SMART_TURN_ENABLED:
    import smart_turn


@app.websocket("/api/asr-streaming")
async def asr_streaming(websocket: WebSocket):
    await websocket.accept()
    loop = asyncio.get_running_loop()

    # Lazy-load — usually warmed at startup, but cover the cold-deploy case.
    try:
        await loop.run_in_executor(None, whisper_runtime._load)
        vad = await loop.run_in_executor(None, vad_runtime.fresh_model)
    except Exception as error:
        await websocket.send_bytes(
            msgpack.packb({"type": "Error", "message": f"STT runtime load failed: {error}"})
        )
        await websocket.close(code=1011)
        return

    await websocket.send_bytes(msgpack.packb({"type": "Ready"}))

    leftover_16k = np.zeros(0, dtype=np.float32)
    utterance_chunks: list[np.ndarray] = []
    lookback_buffer: list[np.ndarray] = []  # ring buffer of recent chunks
    utterance_start_wall: float | None = None
    in_speech = False
    silence_run = 0
    step_idx = 0
    transcribe_in_flight = False
    pending_drain = False
    # Per-connection Smart Turn health. If semantic inference faults mid-stream,
    # flip this off and fall back to the fixed-silence window for the rest of the
    # connection rather than tearing down the STT socket.
    smart_turn_ok = SMART_TURN_ENABLED

    async def transcribe_and_emit():
        """Drain the utterance buffer through faster-whisper and emit Word frames."""
        nonlocal utterance_chunks, transcribe_in_flight
        if not utterance_chunks:
            return
        full = np.concatenate(utterance_chunks)
        utterance_chunks = []
        transcribe_in_flight = True
        try:
            words = await loop.run_in_executor(
                None, whisper_runtime.transcribe_utterance, full
            )
            for text, start_time in words:
                if websocket.client_state.value != 1:  # disconnected
                    return
                await websocket.send_bytes(msgpack.packb({
                    "type": "Word",
                    "text": text,
                    "start_time": float(start_time),
                }))
        except Exception as error:  # noqa: BLE001
            try:
                await websocket.send_bytes(msgpack.packb({
                    "type": "Error",
                    "message": f"transcribe failed: {error}",
                }))
            except Exception:
                pass
        finally:
            transcribe_in_flight = False

    try:
        while True:
            raw = await websocket.receive_bytes()
            try:
                msg = msgpack.unpackb(raw, raw=False)
            except Exception:
                continue
            if not isinstance(msg, dict) or msg.get("type") != "Audio":
                continue
            pcm = msg.get("pcm")
            if pcm is None:
                continue
            pcm_24k = np.asarray(pcm, dtype=np.float32)
            if pcm_24k.size == 0:
                continue

            # Resample → 16 kHz, append to leftover, walk in 512-sample chunks.
            pcm_24k_t = torch.from_numpy(pcm_24k).unsqueeze(0)
            pcm_16k = (
                julius.resample_frac(pcm_24k_t, STT_INPUT_SR, STT_INTERNAL_SR)
                .squeeze(0)
                .numpy()
            )
            leftover_16k = np.concatenate([leftover_16k, pcm_16k])

            chunk_count_this_frame = 0
            while leftover_16k.shape[0] >= SILERO_CHUNK:
                chunk = leftover_16k[:SILERO_CHUNK]
                leftover_16k = leftover_16k[SILERO_CHUNK:]
                chunk_count_this_frame += 1

                speech_prob = float(vad(torch.from_numpy(chunk), STT_INTERNAL_SR).item())

                # Hysteresis-gated speech tracking.
                if not in_speech and speech_prob > VAD_ON_THRESHOLD:
                    in_speech = True
                    silence_run = 0
                    utterance_start_wall = time.time()
                    # Prepend the lookback buffer so the leading phoneme of
                    # the word VAD just caught isn't lost. lookback_buffer
                    # currently holds chunks BEFORE the present one.
                    utterance_chunks.extend(lookback_buffer)
                elif in_speech and speech_prob < VAD_OFF_THRESHOLD:
                    silence_run += 1
                else:
                    silence_run = 0  # speech (or borderline) — reset

                # Maintain ring buffer of recent silence/borderline chunks for
                # the next speech onset. Updated AFTER the lookback prepend so
                # the current chunk is added below as part of utterance_chunks.
                lookback_buffer.append(chunk)
                if len(lookback_buffer) > LOOKBACK_CHUNKS:
                    lookback_buffer.pop(0)

                if in_speech:
                    utterance_chunks.append(chunk)
                    total_samples = sum(c.shape[0] for c in utterance_chunks)
                    if total_samples > MAX_UTTERANCE_SAMPLES:
                        if not transcribe_in_flight and len(utterance_chunks) >= MIN_UTTERANCE_CHUNKS:
                            asyncio.create_task(transcribe_and_emit())
                        in_speech = False
                        silence_run = 0

                # End-of-turn decision. Fixed-silence by default; Smart Turn
                # gates on a completion model when enabled.
                end_turn = False
                if in_speech and len(utterance_chunks) >= MIN_UTTERANCE_CHUNKS:
                    if smart_turn_ok:
                        if silence_run >= SMART_TURN_MAX_SILENCE_CHUNKS:
                            end_turn = True  # safety net — don't hang
                        elif (
                            silence_run >= SMART_TURN_SILENCE_CHUNKS
                            and silence_run % SMART_TURN_SILENCE_CHUNKS == 0
                        ):
                            # Re-check every ~256 ms of silence. Trim the accruing
                            # trailing silence to a fixed pad so pause length stops
                            # biasing the verdict toward "complete".
                            full = np.concatenate(utterance_chunks)
                            drop = max(0, silence_run - SMART_TURN_PAD_CHUNKS) * SILERO_CHUNK
                            speech = full[: full.shape[0] - drop] if 0 < drop < full.shape[0] else full
                            # Offload the ~75 ms inference so it doesn't stall the
                            # WebSocket audio recv loop. A fault here must never
                            # tear down STT — drop to fixed-silence for the rest
                            # of the connection and decide this chunk that way.
                            try:
                                prob = await loop.run_in_executor(
                                    None, smart_turn.predict_completion, speech
                                )
                            except Exception as error:  # noqa: BLE001
                                print(
                                    f"[asr] Smart Turn inference failed; "
                                    f"falling back to fixed-silence endpointing: {error}",
                                    flush=True,
                                )
                                smart_turn_ok = False
                                end_turn = silence_run >= END_OF_SPEECH_SILENCE_CHUNKS
                            else:
                                if prob >= SMART_TURN_THRESHOLD:
                                    end_turn = True
                    elif silence_run >= END_OF_SPEECH_SILENCE_CHUNKS:
                        end_turn = True

                if end_turn:
                    in_speech = False
                    silence_run = 0
                    if not transcribe_in_flight:
                        asyncio.create_task(transcribe_and_emit())
                    else:
                        pending_drain = True

            # Emit ONE Step per inbound WS frame (≈12.5 Hz) rather than per
            # silero chunk (≈31 Hz). The client only thresholds prs[2] for
            # speculation; 80 ms granularity is more than enough.
            if chunk_count_this_frame > 0:
                pause_pr = (
                    min(1.0, silence_run / END_OF_SPEECH_SILENCE_CHUNKS)
                    if in_speech
                    else min(1.0, 0.5 + silence_run / END_OF_SPEECH_SILENCE_CHUNKS)
                )
                await websocket.send_bytes(msgpack.packb({
                    "type": "Step",
                    "step_idx": step_idx,
                    "prs": [0.0, 0.0, pause_pr, 0.0],
                }))
                step_idx += 1

            # If a transcription finished while another was queued, drain it.
            if pending_drain and not transcribe_in_flight and utterance_chunks:
                pending_drain = False
                if len(utterance_chunks) >= MIN_UTTERANCE_CHUNKS:
                    asyncio.create_task(transcribe_and_emit())

    except WebSocketDisconnect:
        # Final drain so the last utterance isn't lost on a clean client close.
        if utterance_chunks and len(utterance_chunks) >= MIN_UTTERANCE_CHUNKS:
            try:
                await transcribe_and_emit()
            except Exception:
                pass
    except Exception as error:  # noqa: BLE001
        try:
            await websocket.send_bytes(msgpack.packb({
                "type": "Error",
                "message": f"asr-streaming fault: {error}",
            }))
        except Exception:
            pass
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
