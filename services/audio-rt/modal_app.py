"""Modal deployment of the Kyutai audio-rt FastAPI gateway on a GPU.

Usage:
    pip install modal
    modal token new                       # one-time auth
    modal deploy services/audio-rt/modal_app.py

For iterative dev (hot-reloading endpoint, no need to redeploy on edits):
    modal serve services/audio-rt/modal_app.py

After deploy, Modal prints a URL like:
    https://<workspace>--audio-rt-kyutai-fastapi-app.modal.run

Paste that URL into .env as KYUTAI_BASE_URL and the admin app routes will
reach the GPU gateway with no other code changes.
"""

from pathlib import Path

import modal

ROOT = Path(__file__).parent

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "torch==2.8.0",
        index_url="https://download.pytorch.org/whl/cu128",
    )
    .pip_install_from_requirements(str(ROOT / "requirements.txt"))
    .add_local_dir(str(ROOT), "/app", copy=True)
)

hf_cache = modal.Volume.from_name(
    "audio-rt-hf-cache",
    create_if_missing=True,
)

app = modal.App("audio-rt-kyutai")


@app.function(
    image=image,
    gpu="T4",
    timeout=600,
    scaledown_window=600,
    volumes={"/root/.cache/huggingface": hf_cache},
    min_containers=0,
)
@modal.concurrent(max_inputs=4)
@modal.asgi_app()
def fastapi_app():
    import os
    import sys

    sys.path.insert(0, "/app")
    os.environ.setdefault("KYUTAI_STT_DEVICE", "cuda")
    os.environ.setdefault(
        "KYUTAI_STT_HF_REPO",
        "kyutai/stt-1b-en_fr",
    )
    os.environ.setdefault("HF_HOME", "/root/.cache/huggingface")

    from gateway import app as gateway_app, stt_runtime

    try:
        stt_runtime._load()
        print(
            f"[modal] kyutai stt model loaded on {stt_runtime.status()}",
            flush=True,
        )
    except Exception as error:
        print(f"[modal] stt preload failed: {error}", flush=True)

    return gateway_app
