# 0023 — Model-slot registry replaces mutual unload-on-load

Date: 2026-07-08
Status: accepted

## Context
"One heavy model resident" (ADR 0014 serializes the jobs) was enforced by each
pipe-caching service (pipeline, upscale, inpaint_engine, edit) lazy-importing every
OTHER service and calling its `unload()` before loading — 5 hand-wired fan-out
sites, O(n²) coupling. Adding a model service meant editing all others.

## Decision
`services/model_slots.py`: each service registers `(slot_name, unload)` at import;
before loading, it calls `acquire(<own slot>)`, which unloads every other registered
slot + `vram.release()`. Slots: `generation`, `upscale`, `inpaint`, `edit`.
Job serialization stays with `job_guard` (ADR 0014); the registry only owns the
VRAM handoff. Services keep their own cache internals (upscale's `keep_slug`
self-partial unload stays service-local).

## Consequences
- New model service = 1 `register` call; no other service changes.
- A service not yet imported holds no VRAM → safely skipped by `acquire`.
- Same runtime behavior as the hand-wired fan-outs (each unload still releases).
