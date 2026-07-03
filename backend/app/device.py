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
