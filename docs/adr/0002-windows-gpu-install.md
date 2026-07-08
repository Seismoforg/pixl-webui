---
status: accepted
date: 2026-07-03
---

# Context
The target platform is Windows. PyTorch must be installed differently per GPU
vendor: NVIDIA uses official CUDA wheels, while AMD on Windows needs ROCm wheels,
which are provided by the `rocm-torch-windows` project (TheRock multi-arch index).

# Decision
Target Windows only. The installer (`install.ps1`) detects the GPU vendor via
`Get-CimInstance Win32_VideoController` and installs the matching PyTorch build:
NVIDIA → CUDA wheels; AMD → ROCm via `rocm-torch-windows`; otherwise CPU.

# Rationale
- `rocm-torch-windows` is Windows-specific and matches the project's platform.
- A single PowerShell installer keeps setup one-click and reproducible.
- Vendor detection avoids asking users to pick the right wheel manually.

# Consequences
- Linux/macOS are out of scope for now (would need a different ROCm path).
- ROCm wheels are AMD nightlies and can occasionally break; `-Force` rebuilds.
- The AMD gfx-architecture mapping must track the rocm-torch-windows support list
  (superseded by ADR 0018: gfx detection is now delegated to the fetched module).

# Related
- ADR 0001 (diffusers engine), ADR 0018 (installer fetches the rocm module)
