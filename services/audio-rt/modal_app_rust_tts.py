"""Modal deployment of Kyutai TTS via moshi-server (Rust + Python TTS module).

Same Rust binary as modal_app_rust.py (the STT deploy), but pointed at
config-tts.toml. The TTS module is `type = "Py"`, meaning moshi-server
delegates to a Python implementation via pyo3 — so the image also needs
the `moshi` Python package and CUDA torch installed.

Endpoint: wss://<workspace>--audio-rt-moshi-tts-serve.modal.run/api/tts_streaming
Protocol (msgpack):
  client -> server : {type: "Text", text: "<word>"} ... {type: "Eos"}
  server -> client : {type: "Audio", pcm: Float32[24kHz mono]}
Auth: ?auth_id=public_token (or `kyutai-api-key` header).

Deploy:
    modal deploy services/audio-rt/modal_app_rust_tts.py

Test from local Mac (saves WAV):
    /tmp/moshi-venv/bin/pip install tqdm
    echo "Hello this is a test of the Kyutai text to speech system." | \\
      /tmp/moshi-venv/bin/python services/audio-rt/scripts/tts_rust_server.py \\
        - /tmp/kyutai-tts.wav \\
        --url wss://binnyplotkin--audio-rt-moshi-tts-serve.modal.run
"""

from pathlib import Path

import modal

ROOT = Path(__file__).parent

image = (
    # NB: no `add_python` argument. We rely solely on deadsnakes' python3.12
    # so there is exactly one Python tree in the image — Modal's add_python
    # creates a second one at /usr/local that confuses pyo3 at runtime
    # (pip installs land in /usr while pyo3 ends up using /usr/local's
    # half-installed stdlib, missing C extensions like _contextvars).
    modal.Image.from_registry(
        "nvidia/cuda:12.6.2-cudnn-devel-ubuntu22.04",
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
        # Single Python install: deadsnakes' python3.12 with full stdlib +
        # libpython3.12 for moshi-server's pyo3 link. Bootstrap pip directly
        # against this interpreter, then symlink so Modal's runtime (which
        # looks for `python3`) finds it.
        "add-apt-repository -y ppa:deadsnakes/ppa",
        "apt-get update -y",
        "DEBIAN_FRONTEND=noninteractive apt-get install -y "
        "python3.12 python3.12-dev python3.12-venv",
        "curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py",
        "/usr/bin/python3.12 /tmp/get-pip.py",
        "ln -sf /usr/bin/python3.12 /usr/local/bin/python3",
        "ln -sf /usr/bin/python3.12 /usr/local/bin/python",
    )
    .run_commands(
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | "
        "sh -s -- -y --default-toolchain stable --profile minimal",
    )
    .env(
        {
            "PATH": "/root/.cargo/bin:/usr/local/cuda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "LD_LIBRARY_PATH": "/usr/local/cuda/lib64:/usr/local/cuda/extras/CUPTI/lib64",
            "CUDA_PATH": "/usr/local/cuda",
            "CUDA_HOME": "/usr/local/cuda",
            "CUDA_COMPUTE_CAP": "89",
            # Tell the pyo3-embedded Python where its stdlib + lib-dynload live.
            "PYTHONHOME": "/usr",
        }
    )
    .run_commands(
        "git clone --depth 1 https://github.com/kyutai-labs/moshi.git /opt/moshi",
        "cd /opt/moshi/rust && cargo install --features cuda --path moshi-server",
    )
    # Python deps for the TTS module (type = "Py" in config-tts.toml).
    # IMPORTANT: install via deadsnakes' python3.12, NOT Modal's add_python
    # interpreter. moshi-server's pyo3 dlopen-loads libpython3.12 from the
    # apt install at runtime, so packages must live in *that* Python's
    # site-packages — Modal's pip_install lands them somewhere pyo3 cannot
    # see, and you get `ModuleNotFoundError: No module named 'huggingface_hub'`
    # even though pip claimed success.
    .run_commands(
        # Beyond `moshi`'s own pin, the TTS python module (loaded via pyo3
        # from /opt/moshi/moshi-server/python) imports pydantic, sentencepiece,
        # safetensors, sphn, msgpack — none of which are guaranteed by the
        # 0.2.11 wheel's deps. Easier to overpack than to round-trip on each
        # missing import.
        "/usr/bin/python3.12 -m pip install --no-cache-dir "
        "moshi==0.2.11 huggingface_hub julius==0.2.7 soundfile==0.13.1 librosa==0.11.0 "
        "pydantic sentencepiece safetensors sphn msgpack einops numpy",
        # `moshi==0.2.11` pins torch <2.8 and the install above drags in CPU
        # torch 2.7.1 from PyPI default — useless on an L4. Force-reinstall a
        # CUDA wheel last so the final state is GPU-capable. We use cu126 (not
        # cu128) because the base image is CUDA 12.6.2 — cu128 torch needs
        # nvJitLink 12.8 symbols that aren't in the runtime here, and would
        # crash on import: `undefined symbol __nvJitLinkCreate_12_8`.
        "/usr/bin/python3.12 -m pip install --no-cache-dir --upgrade --force-reinstall "
        "torch==2.6.0 --index-url https://download.pytorch.org/whl/cu126",
    )
    .add_local_dir(
        str(ROOT / "configs"),
        "/app/configs",
        copy=True,
    )
)

# Persistent HF cache so voice .safetensors and the TTS model only download once.
hf_cache = modal.Volume.from_name(
    "moshi-server-tts-hf-cache",
    create_if_missing=True,
)

app = modal.App("audio-rt-moshi-tts")


@app.function(
    image=image,
    gpu="L4",
    timeout=600,
    scaledown_window=600,
    volumes={"/root/.cache/huggingface": hf_cache},
    min_containers=0,
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=8080, startup_timeout=600)
def serve():
    import os
    import subprocess

    os.environ.setdefault("HF_HOME", "/root/.cache/huggingface")

    config_path = "/app/configs/config-tts.toml"

    subprocess.Popen(
        [
            "moshi-server",
            "worker",
            "--config",
            config_path,
        ],
    )
