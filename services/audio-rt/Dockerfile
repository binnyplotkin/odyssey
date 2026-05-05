FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.8.0
RUN pip install --no-cache-dir -r /app/requirements.txt
# Belt-and-suspenders: if any transitive dep pulled onnxruntime-gpu,
# remove it. CPU-only onnxruntime is pinned in requirements.txt.
RUN pip uninstall -y onnxruntime-gpu 2>/dev/null || true

COPY . /app

# Pocket TTS downloads weights from HuggingFace at startup.
# Pin HF cache to a known path so it's stable across Railway's filesystem.
# HF_TOKEN must be set as a Railway env var (gated repo: kyutai/pocket-tts).
ENV HF_HOME=/app/.cache/huggingface
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn gateway:app --host 0.0.0.0 --port ${PORT}"]
