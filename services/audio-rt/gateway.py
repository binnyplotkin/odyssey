import base64
import itertools
import math
import os
import subprocess
import tempfile
from threading import Lock

import julius
import moshi.models
import sphn
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="odyssey-audio-rt")


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
        "mode": "stt-ready",
        "sttRuntime": stt_runtime.status(),
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
def speak(_: SpeakRequest):
    raise HTTPException(
        status_code=501,
        detail="Kyutai runtime not wired yet. Service is deployed and reachable.",
    )
