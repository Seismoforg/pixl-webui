---
status: accepted
date: 2026-07-07
---

# Context
`install.ps1` hand-rolled the AMD/ROCm PyTorch setup: a `Get-GfxArch` GPU->gfx
regex map and a manual `pip install rocm[...] torch[...] torchvision[...]` against
the ROCm nightly index. That logic already exists — better, data-driven — in the
sibling project `rocm-torch-windows` (github.com/Seismoforg/rocm-torch-windows),
a reusable PowerShell module (`RocmVenv`). Duplicating it here means the two drift.

Goal: reuse the module WITHOUT forcing a second repo checkout, and stay failsafe.

# Decision
Fetch the module from GitHub at install time, pinned to a commit; delegate the
AMD path to it; keep no inline fallback.

- `install.ps1` downloads the module zipball for a pinned commit
  (`codeload.github.com/Seismoforg/rocm-torch-windows/zip/<sha>`) into a
  git-ignored cache `.rocm-module/`, then `Import-Module` from it.
- Download via `Invoke-WebRequest` + `Expand-Archive` — no `git` needed, works
  from a ZIP checkout. Repo is public — no token.
- Pinned ref: `20a28c717ceccfdc9bd6419faece9015215ef4d2`. Reproducible, insulated
  from upstream/nightly churn. Bump the pin to adopt upstream fixes.
- AMD path calls `Initialize-RocmVenv -VenvPath .venv -SkipBitsAndBytes` (reuses the
  venv, installs rocm + torch + torchvision + torchaudio, verifies GPU). bnb is
  skipped: the backend quantizes via GGUF, not bitsandbytes.
- Deleted from `install.ps1`: `Get-GfxArch`, `$RocmIndex`, the hand-rolled AMD
  pip line.
- nvidia (CUDA) + cpu branches stay inline — the module is AMD/ROCm-only.

# Rationale
- Reproducible: a pinned commit can't break under someone mid-install.
- No second checkout / no `git` / ZIP-safe: zipball over HTTPS.
- No offline fallback needed: the install already needs network for the ROCm
  wheels, so a failed fetch fails the whole install anyway — an inline fallback
  would guard nothing while re-introducing the duplication we removed.
- `-SkipBitsAndBytes`: the backend quantizes via GGUF, not bitsandbytes — bnb is
  unused at runtime, so skipping it keeps the install footprint unchanged.

Alternatives rejected:
- Vendor a copy in-repo — self-contained but drifts from upstream, needs manual
  re-sync.
- Git submodule — breaks on ZIP download (empty dir), adds git friction; closest
  to the "second checkout" we wanted to avoid.

# Consequences
- Install now needs to reach `github.com`/`codeload.github.com` (on top of the
  ROCm wheel index it already needed). Fully offline install was already
  impossible for GPU wheels — no real regression.
- External coupling: the pinned commit must stay on origin and the repo public.
- Adopting upstream fixes is a one-line pin bump in `install.ps1`.
- To later enable NF4/LoRA via bitsandbytes: drop `-SkipBitsAndBytes` (this pin
  carries the bnb step) and install bnb AFTER `pip -e backend` to avoid a PyPI
  clobber.
