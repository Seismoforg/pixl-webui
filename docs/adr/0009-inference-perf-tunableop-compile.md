---
status: accepted
date: 2026-07-05
---

# Context
GGUF FLUX (and diffusion generally) is slow per iteration on ROCm while leaving
VRAM unused — the bottleneck is compute (GGUF dequantizes weights every forward
pass; ROCm GEMM/attention kernels are less optimized than CUDA), not memory. Free
VRAM cannot speed up a compute-bound loop, so the win has to come from faster
kernels. Two diffusers-compatible levers exist:
- **TunableOp** (ROCm) — benchmarks candidate GEMM implementations and picks the
  fastest for the actual GPU, cacheable to a results file.
- **torch.compile** — graph capture + fusion of the denoising module, reducing
  Python/kernel-launch overhead.

# Decision
Apply both, with different exposure:

- **TunableOp: automatic, ROCm only.** The pipeline load prologue calls
  `torch.cuda.tunable.enable(True)` when the torch backend is ROCm, and the results
  file is pinned into `data/` (via `PYTORCH_TUNABLEOP_FILENAME`) so the one-time
  tuning persists across restarts — the same tradeoff already accepted for the
  MIOpen warmup. Gated to ROCm because NVIDIA's cuBLAS is already well-tuned.
- **torch.compile: opt-in setting, default off.** A `torch_compile` performance
  toggle compiles the denoising module (`transformer`/`unet`) at load. It is
  best-effort (try/except) and additionally **Triton-guarded**: because inductor
  needs Triton and compiles lazily on the first forward (outside the try/except),
  the code skips compiling on a GPU without Triton so a missing Triton can't break
  generation. Default off because the first run pays a long compile cost and ROCm
  compile support is uneven.

# Rationale
- TunableOp is a pure, cached speedup on AMD with no behavioral change, so
  auto-enabling it (like MIOpen) needs no user decision.
- torch.compile has real costs and failure modes (long first-run compile, ROCm
  fragility, Triton requirement), so it must be opt-in and fail safe rather than
  on-by-default.
- Both integrate at the existing shared pipeline-load / `apply_perf` seam, keeping
  the change additive and off the non-GPU paths.

# Consequences
- On ROCm, the first generation after a fresh install/tuning-cache is slower while
  TunableOp tunes; subsequent runs reuse `data/tunableop_results.csv`.
- The `torch_compile` toggle is inert on setups without Triton (e.g. the current
  ROCm env has no `pytorch-triton-rocm`); it becomes effective once Triton is
  installed. Recorded as technical debt.
- Gains are bounded by ROCm kernel maturity and are measured (it/s) rather than
  assumed.
