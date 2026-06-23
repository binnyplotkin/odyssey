"""Smart Turn v3 — semantic (audio-native) end-of-turn detection.

Gates the end-of-turn decision on a turn-completion model instead of a fixed
silence window, so the server fires fast on a complete utterance and keeps
listening through a mid-sentence pause. Used alongside (not instead of)
silero VAD: silero says "there's a pause", Smart Turn says "is the turn
actually over".

Optional — only imported when SMART_TURN_ENABLED=1, so the default build
keeps its current behaviour and doesn't pull transformers.

Model: pipecat-ai/smart-turn-v3 (ONNX, ~8MB, Apache-2.0). Input is 16kHz
mono PCM (last 8s of the turn); preprocessing is Whisper log-mel features,
exactly as the upstream inference.py. The single output is P(turn complete)
in [0,1] — the upstream code thresholds it at 0.5 directly (it is already a
probability despite the "logits" output name).
"""

import os
from typing import Optional

import numpy as np

_session = None
_fe = None

SAMPLE_RATE = 16000
MAX_SECONDS = 8


def _load() -> None:
    global _session, _fe
    if _session is not None:
        return
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from transformers import WhisperFeatureExtractor

    model_file = os.getenv("SMART_TURN_MODEL", "smart-turn-v3.1-cpu.onnx")
    path = hf_hub_download("pipecat-ai/smart-turn-v3", model_file)

    opts = ort.SessionOptions()
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    opts.intra_op_num_threads = 1
    opts.inter_op_num_threads = 1
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    _session = ort.InferenceSession(path, sess_options=opts)
    _fe = WhisperFeatureExtractor(chunk_length=MAX_SECONDS)


def predict_completion(audio_16k: np.ndarray) -> float:
    """P(turn complete) in [0,1] for 16kHz mono audio (only the last 8s used)."""
    _load()
    a = np.asarray(audio_16k, dtype=np.float32)
    if a.shape[0] > MAX_SECONDS * SAMPLE_RATE:
        a = a[-MAX_SECONDS * SAMPLE_RATE :]
    inputs = _fe(
        a,
        sampling_rate=SAMPLE_RATE,
        return_tensors="np",
        padding="max_length",
        max_length=MAX_SECONDS * SAMPLE_RATE,
        truncation=True,
        do_normalize=True,
    )
    feats = np.expand_dims(inputs.input_features.squeeze(0).astype(np.float32), axis=0)
    out = _session.run(None, {"input_features": feats})[0]
    return float(np.array(out).reshape(-1)[0])


def warm() -> Optional[float]:
    """Load weights + prime the graph so the first real call isn't slow."""
    return predict_completion(np.zeros(SAMPLE_RATE, dtype=np.float32))


def is_loaded() -> bool:
    """Whether the ONNX session is loaded — True only after warm()/the first
    predict has succeeded. Lets /healthz tell 'flag on and working' apart from
    'flag on but warm-up faulted' (which silently falls back to fixed silence)."""
    return _session is not None
