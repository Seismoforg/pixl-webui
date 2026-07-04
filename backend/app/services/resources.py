"""Live system-resource metrics for the status bar.

CPU and RAM come from ``psutil``; VRAM from torch's ``mem_get_info``. GPU compute
utilisation is best-effort: NVIDIA via pynvml (``torch.cuda.utilization()``), else
the ``gpu_win`` Windows PerfMon-counter fallback (works on AMD/ROCm without any
vendor SMI). It is reported as ``None`` only when neither path is available, rather
than a misleading zero.
"""
from __future__ import annotations

from pydantic import BaseModel

_GB = 1024**3


class ResourceStats(BaseModel):
    cpu_percent: float
    ram_used_gb: float
    ram_total_gb: float
    ram_percent: float
    vram_used_gb: float | None = None
    vram_total_gb: float | None = None
    vram_percent: float | None = None
    gpu_percent: float | None = None  # best-effort; None if no SMI available


def _round(value: float) -> float:
    return round(value, 2)


def _gpu_stats() -> tuple[float | None, float | None, float | None, float | None]:
    """Return (vram_used_gb, vram_total_gb, vram_percent, gpu_percent)."""
    try:
        import torch
    except ImportError:
        return None, None, None, None

    if not torch.cuda.is_available():
        return None, None, None, None

    free, total = torch.cuda.mem_get_info()
    used = total - free
    vram_used = _round(used / _GB)
    vram_total = _round(total / _GB)
    vram_percent = _round(used / total * 100) if total else None

    gpu_percent: float | None = None
    try:  # NVIDIA path: needs pynvml (bundled with CUDA torch)
        gpu_percent = float(torch.cuda.utilization())
    except Exception:  # noqa: BLE001 - not available on ROCm/Windows
        gpu_percent = None
    if gpu_percent is None:
        # Vendor-agnostic Windows fallback (works for AMD/ROCm).
        from . import gpu_win

        gpu_percent = gpu_win.get_gpu_percent()

    return vram_used, vram_total, vram_percent, gpu_percent


def get_stats() -> ResourceStats:
    import psutil

    vmem = psutil.virtual_memory()
    vram_used, vram_total, vram_percent, gpu_percent = _gpu_stats()

    return ResourceStats(
        cpu_percent=_round(psutil.cpu_percent(interval=None)),
        ram_used_gb=_round((vmem.total - vmem.available) / _GB),
        ram_total_gb=_round(vmem.total / _GB),
        ram_percent=_round(vmem.percent),
        vram_used_gb=vram_used,
        vram_total_gb=vram_total,
        vram_percent=vram_percent,
        gpu_percent=gpu_percent,
    )
