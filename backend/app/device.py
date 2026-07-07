"""GPU/device detection and the torch backend report.

``torch`` is imported lazily so the API can still start and report a helpful
status if PyTorch has not been installed yet.
"""
from __future__ import annotations

from pydantic import BaseModel


class DeviceInfo(BaseModel):
    torch_available: bool
    backend: str  # "cuda" | "rocm" | "cpu" | "none"
    device: str  # torch device string: "cuda" | "cpu"
    gpu_name: str | None = None
    torch_version: str | None = None


def get_device_info() -> DeviceInfo:
    try:
        import torch
    except ImportError:
        return DeviceInfo(torch_available=False, backend="none", device="cpu")

    if torch.cuda.is_available():
        # ROCm PyTorch also reports cuda.is_available() == True but sets version.hip.
        is_rocm = getattr(torch.version, "hip", None) is not None
        return DeviceInfo(
            torch_available=True,
            backend="rocm" if is_rocm else "cuda",
            device="cuda",
            gpu_name=torch.cuda.get_device_name(0),
            torch_version=torch.__version__,
        )

    return DeviceInfo(
        torch_available=True,
        backend="cpu",
        device="cpu",
        torch_version=torch.__version__,
    )


def get_torch_device() -> str:
    return get_device_info().device


def get_dtype():
    """float16 on GPU, float32 on CPU."""
    import torch

    return torch.float16 if get_torch_device() == "cuda" else torch.float32


def get_compute_dtype():
    """bfloat16 on GPU, float32 on CPU — the compute dtype for GGUF FLUX.

    FLUX is trained in bfloat16 and diffusers' GGUF dequantization expects a bf16
    compute dtype, so the GGUF load path uses this instead of :func:`get_dtype`."""
    import torch

    return torch.bfloat16 if get_torch_device() == "cuda" else torch.float32


def place_offloaded(pipe):
    """Place a loaded pipe: plain .to("cpu") on CPU, else CPU-offload so encoders
    stream off the GPU during denoising (bounds peak VRAM). Returns the pipe."""
    if get_torch_device() == "cpu":
        return pipe.to("cpu")
    pipe.enable_model_cpu_offload()
    return pipe


def make_generator(seed: int | None):
    """A seeded ``torch.Generator`` on the active device for a reproducible run, or
    None (random) when no seed is given."""
    if seed is None:
        return None
    import torch

    return torch.Generator(device=get_torch_device()).manual_seed(int(seed))


def load_gguf_pipe(model_path, gguf_filename: str, transformer_cls, pipeline_cls):
    """Build a GGUF-quantized pipe: only the transformer is quantized (from the local
    ``.gguf``); the base repo at ``model_path`` supplies VAE/text-encoders/scheduler.
    CPU-offloaded so the T5 encoder streams off the GPU (keeps peak VRAM ~16 GB).
    Shared by the FLUX Fill/Kontext engines and the generation GGUF path."""
    from diffusers import GGUFQuantizationConfig

    dtype = get_compute_dtype()
    transformer = transformer_cls.from_single_file(
        str(model_path / gguf_filename),
        config=str(model_path / "transformer"),
        quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
        torch_dtype=dtype,
    )
    pipe = pipeline_cls.from_pretrained(
        str(model_path), transformer=transformer, torch_dtype=dtype
    )
    return place_offloaded(pipe)
