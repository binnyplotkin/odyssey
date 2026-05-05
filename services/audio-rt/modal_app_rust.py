"""Modal deployment of Kyutai's Rust `moshi-server` on a GPU.

This is the production-grade STT path:
- Built from kyutai-labs/moshi (Rust workspace) with `--features cuda`.
- Streams audio over WebSocket at /api/asr-streaming using msgpack.
- Eliminates the Python-loop overhead that bottlenecks the pytorch gateway.

Deploy:
    modal deploy services/audio-rt/modal_app_rust.py

Connected to from the browser via apps/admin/src/lib/moshi-client.ts
(MOSHI_WS_URL → wss://<workspace>--audio-rt-moshi-server-serve.modal.run/api/asr-streaming).
Migrating this onto the Railway audio-rt FastAPI gateway is a separate
effort; until then this Modal deploy must stay live for live STT.

The moshi-server is published in the kyutai-labs/moshi repo's `rust/`
workspace, not on crates.io as a standalone install. We clone the repo and
`cargo install --path` the workspace member.
"""

from pathlib import Path

import modal

ROOT = Path(__file__).parent

# CUDA 12.4 + cuDNN base — candle (used by moshi-server) needs both at runtime.
# Modal GPU instances ship drivers compatible with CUDA 12.x.
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.6.2-cudnn-devel-ubuntu22.04",
        add_python="3.12",
    )
    .apt_install(
        "build-essential",
        "pkg-config",
        "libssl-dev",
        "ca-certificates",
        "curl",
        "git",
        "cmake",
        "software-properties-common",
    )
    .run_commands(
        # moshi-server links against libpython3.12 via pyo3. Modal's
        # `add_python="3.12"` installs the interpreter but not the dev shared
        # library in the linker's search path. Install python3.12-dev from
        # deadsnakes so `-lpython3.12` resolves.
        "add-apt-repository -y ppa:deadsnakes/ppa",
        "apt-get update -y",
        "DEBIAN_FRONTEND=noninteractive apt-get install -y python3.12-dev",
    )
    .run_commands(
        # Install Rust (stable; needs >=1.85 for edition 2024).
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | "
        "sh -s -- -y --default-toolchain stable --profile minimal",
    )
    .env(
        {
            "PATH": "/root/.cargo/bin:/usr/local/cuda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "LD_LIBRARY_PATH": "/usr/local/cuda/lib64:/usr/local/cuda/extras/CUPTI/lib64",
            "CUDA_PATH": "/usr/local/cuda",
            "CUDA_HOME": "/usr/local/cuda",
            # bindgen_cuda normally calls `nvidia-smi` at build time to detect
            # compute capability — but Modal builds on a CPU-only host. Pin
            # explicitly. L4 = sm_89 (Ada Lovelace). T4's sm_75 fails because
            # candle-kernels' vllm_rs MoE kernels require WMMA bf16 (sm_80+).
            "CUDA_COMPUTE_CAP": "89",
        }
    )
    .run_commands(
        # Clone Kyutai's moshi repo and install moshi-server with CUDA support.
        # Using a pinned shallow clone so future deploys don't silently drift.
        "git clone --depth 1 https://github.com/kyutai-labs/moshi.git /opt/moshi",
        "cd /opt/moshi/rust && cargo install --features cuda --path moshi-server",
    )
    .add_local_dir(
        str(ROOT / "configs"),
        "/app/configs",
        copy=True,
    )
)

# Persistent HF cache so the ~2GB candle weights only download once across
# container starts. Separate from the pytorch path's volume so they don't
# collide on differing snapshot layouts.
hf_cache = modal.Volume.from_name(
    "moshi-server-hf-cache",
    create_if_missing=True,
)

app = modal.App("audio-rt-moshi-server")


@app.function(
    image=image,
    gpu="L4",
    timeout=600,
    scaledown_window=600,
    volumes={"/root/.cache/huggingface": hf_cache},
    min_containers=0,
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=8080, startup_timeout=300)
def serve():
    """Start moshi-server and let Modal proxy traffic to localhost:8080.

    `@modal.web_server` semantics: this function runs once per container.
    It must spawn the server process and return; Modal then waits for the
    port to accept connections (up to startup_timeout) before routing
    incoming requests.
    """
    import os
    import subprocess

    os.environ.setdefault("HF_HOME", "/root/.cache/huggingface")

    config_path = "/app/configs/config-stt-en_fr-hf.toml"

    # `moshi-server worker` reads the [modules.*] sections and binds 0.0.0.0:8080
    # by default. Logs go to stdout/stderr which Modal captures.
    subprocess.Popen(
        [
            "moshi-server",
            "worker",
            "--config",
            config_path,
        ],
    )
