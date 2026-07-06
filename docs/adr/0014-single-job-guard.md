---
status: accepted
date: 2026-07-06
---

# Context
5 heavy job types (generation, upscale, reframe, inpaint, edit) each run one
background job in their OWN store, but all contend for the SAME GPU. The model
services coordinate VRAM by unloading each other on load (mutual lazy-import
unload; ADRs 0010/0013). Two *different* job types starting at once → the mutual
unloads interleave → both heavy pipes stay resident → OOM. Per-router single-job
tracking is not enough; the invariant is process-wide.

# Decision
`services/job_guard.py` — process-wide single-heavy-job guard:
- `acquire(job_id, kind)` — atomic under a lock. Returns `None` on success, else
  the `kind` of the already-running job (leaving it untouched).
- `release(job_id)` — drop from the active set (no-op if absent).
- Every job router acquires on POST start; a busy guard → `409` with
  `messages.JOB_BUSY`. Releases in the `_run` `finally`.

At most one heavy job (any type) runs across the whole process.

# Rationale
- The VRAM mutual-unload design assumes serialized jobs; the guard makes that
  assumption explicit and enforced rather than implicit.
- Process-wide (not per-router) because the contention is the shared GPU, which
  no per-store lock covers.
- `409` (not a queue) keeps it simple: the client already polls/retries; a server
  queue would add state with no user benefit at single-user scale.

# Consequences
- No parallel jobs — a second start is rejected, not queued. Acceptable: one GPU,
  one user.
- Every job router must acquire/release; a router that forgets the `finally`
  release would wedge the guard. Covered by the uniform router pattern.
- Referenced by ADRs 0012/0013 as the settled concurrency invariant.
