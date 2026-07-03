"""Best-effort GPU compute utilisation on Windows (vendor-agnostic).

Windows exposes per-engine GPU load through the ``\\GPU Engine(*)\\Utilization
Percentage`` performance counters — the same source Task Manager uses, and it
works for AMD/ROCm where no NVML/amdsmi is available. Re-enumerating the counters
each sample also catches processes that start later (e.g. the inference worker).

A single long-lived PowerShell process streams one aggregated value per interval;
a reader thread caches it so the HTTP endpoint never blocks. Any failure (non-
Windows, PowerShell missing, counters absent) degrades to ``None``.
"""
from __future__ import annotations

import os
import subprocess
import threading

# Per-engine utilisation is summed across processes, then the busiest engine is
# taken (mirrors Task Manager's headline GPU %).
_SCRIPT = (
    "$ErrorActionPreference='SilentlyContinue';"
    "while($true){"
    "  $s=(Get-Counter '\\GPU Engine(*)\\Utilization Percentage').CounterSamples;"
    "  if($s){"
    "    $m=($s | Group-Object { ($_.InstanceName -replace '.*(eng_\\d+).*','$1') }"
    "      | ForEach-Object { ($_.Group | Measure-Object CookedValue -Sum).Sum }"
    "      | Measure-Object -Maximum).Maximum;"
    "    [Console]::Out.WriteLine([math]::Round($m,1))"
    "  } else { [Console]::Out.WriteLine('') };"
    "  Start-Sleep -Milliseconds 1500"
    "}"
)

_latest: float | None = None
_started = False
_unavailable = False
_lock = threading.Lock()


def _reader(proc: subprocess.Popen) -> None:
    global _latest, _unavailable
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line:
            _latest = None
            continue
        try:
            # PowerShell formats with the OS locale, which may use a comma decimal.
            _latest = min(100.0, float(line.replace(",", ".")))
        except ValueError:
            _latest = None
    # Process ended: stop reporting stale numbers.
    _latest = None
    _unavailable = True


def _start() -> None:
    global _started, _unavailable
    _started = True
    try:
        proc = subprocess.Popen(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", _SCRIPT],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError:
        _unavailable = True
        return
    threading.Thread(target=_reader, args=(proc,), daemon=True).start()


def get_gpu_percent() -> float | None:
    """Latest GPU utilisation percent, or ``None`` if unavailable."""
    if os.name != "nt" or _unavailable:
        return None
    if not _started:
        with _lock:
            if not _started:
                _start()
    return _latest
