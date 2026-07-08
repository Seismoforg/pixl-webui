---
status: accepted
date: 2026-07-08
---

# Context
Old / blurry / re-photographed portraits need face restoration that KEEPS the
person's identity. The existing tools don't: Real-ESRGAN (generic GAN) is weak on
heavy blur and not face-aware; the diffusion tools (SD x4, FLUX Kontext / FLUX.2
edit, the image-repair LoRA, plain img2img) REGENERATE pixels and drift the face —
tested on a real blurry photo, img2img at any strength either stayed blurry (low)
or turned the subjects into different children (high). Only a face-specialised
restorer reconstructs a sharp face constrained to the actual face geometry.

# Decision
Add CodeFormer as a `face_restore` engine kind in the upscale service.
- Weights: single `codeformer.pth` loaded via `spandrel` + `spandrel_extra_arches`
  (adds the CodeFormer arch), fetched like Real-ESRGAN. Source repo
  `Arun-Subramanian/codeformer-v0.1.0` (community mirror of the official v0.1.0
  release; byte-identical, 376 MB).
- Pipeline (`upscale._restore_faces`): `facexlib` FaceRestoreHelper detects + aligns
  each face to 512, CodeFormer restores at a `fidelity` weight (0..1,
  identity↔smoothness), faces pasted back onto the pixel-exact source. No detected
  face → source returned unchanged.
- Device split: face DETECTION/parsing (RetinaFace) runs on CPU; CodeFormer restore
  on the GPU. On ROCm/gfx1201 the detector's batch-norm forward raises
  `miopenStatusUnknownError` on GPU; the detector is tiny so CPU is fine.
- Request: optional `fidelity` on the upscale body (default 0.7, identity-leaning),
  mirroring the `sd_x4_steps` per-run override. Frontend: a Fidelity slider on the
  Upscale panel shown only for `face_restore` (no prompt / no tiling for this kind).

# Rationale
- CodeFormer's codebook prior hallucinates plausible face detail bound to the input
  face → sharp AND identity-preserving, which global diffusion cannot do.
- Reusing the upscale engine/catalog/download/job machinery = minimal new surface
  (a kind + a dispatch branch), no new router or job type.
- `facexlib` 0.3.0 imports without `basicsr` (the usual old-stack `functional_tensor`
  break), so it slots onto the bleeding-edge ROCm/torch 2.12 stack cleanly. Deps
  install with the existing backend `pip install` (torch/torchvision already
  satisfied → not re-pulled).

# Consequences
- New backend deps: `facexlib`, `spandrel_extra_arches` (+ their opencv/scipy/filterpy).
  Existing installs need a backend reinstall (`pip install -e backend`) to pick them up.
- `facexlib` auto-downloads its detection + parsing weights (~100 MB) to
  `models/facexlib` on first restore → needs network the first time (tech-debt).
- CodeFormer weight is a community HF mirror, not an official upstream repo → could
  vanish; documented in tech-debt.
- v1 restores at source resolution (no upscale); combine with Real-ESRGAN afterwards
  for print resolution. Only faces are restored — bodies/background keep the source.
- CodeFormer S-Lab license is non-commercial (fine for personal photo restoration).
