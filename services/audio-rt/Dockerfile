FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-smart-turn.txt /app/
# Install torch and torchaudio from the PyTorch CPU index — PyPI's default
# wheels are CUDA-enabled and torchaudio in particular dlopens libcudart at
# import, which crashes silero-vad on a CPU-only Railway container.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch==2.8.0 torchaudio==2.8.0
RUN pip install --no-cache-dir -r /app/requirements.txt
# Optional Smart Turn v3 deps (transformers, pinned to 4.x for moshi's
# huggingface-hub <1.0 constraint). Always installed so the semantic
# endpointer can be turned on with a single env var (SMART_TURN_ENABLED=1)
# without a rebuild — it's inert unless that flag is set.
RUN pip install --no-cache-dir -r /app/requirements-smart-turn.txt
# Belt-and-suspenders: if any transitive dep pulled GPU-only variants,
# remove them. CPU equivalents stay pinned via requirements.txt.
RUN pip uninstall -y onnxruntime-gpu 2>/dev/null || true

COPY . /app

# Pocket TTS downloads weights from HuggingFace at startup.
# Pin HF cache to a known path so it's stable across Railway's filesystem.
# HF_TOKEN must be set as a Railway env var (gated repo: kyutai/pocket-tts).
ENV HF_HOME=/app/.cache/huggingface
ENV PORT=8080
ENV POCKET_TTS_FIRST_AUDIO_TIMEOUT_SECONDS=12
ENV POCKET_TTS_TOTAL_TIMEOUT_SECONDS=120
ENV POCKET_TTS_RESTART_ON_STALL=1
# Worker count for uvicorn. Each worker is its own Python process with its
# own Pocket TTS / Whisper model instances, so concurrent /speak requests
# parallelize across workers (the in-process generate lock keeps each
# worker's streaming state safe). 2 is a reasonable demo default — bump
# via Railway env if more concurrency is needed. Memory cost is ~400MB per
# warmed worker.
ENV UVICORN_WORKERS=2
# Smart Turn v3 semantic endpointing — OFF by default; the deps above are
# installed but inert. Set SMART_TURN_ENABLED=1 in the Railway env to turn it
# on (the ~8MB model downloads from HF on startup — public repo, no token).
# Tuning knobs (code defaults shown): SMART_TURN_THRESHOLD=0.5,
# SMART_TURN_SILENCE_CHUNKS=14 (~448ms first check), SMART_TURN_PAD_CHUNKS=3,
# SMART_TURN_MAX_SILENCE_CHUNKS=63 (~2s safety force-end).
ENV SMART_TURN_ENABLED=0
EXPOSE 8080

CMD ["sh", "-c", "uvicorn gateway:app --host 0.0.0.0 --port ${PORT} --workers ${UVICORN_WORKERS}"]
