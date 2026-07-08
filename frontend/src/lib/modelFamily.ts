/** Capability rules that vary by generation-model family. Mirrors the
 *  families defined in `backend/app/catalog.py` ("SD 1.5" | "SDXL" | "FLUX" |
 *  "SD 3.x" | "Z-Image" | "FLUX.2"). `family` is `undefined` when the model isn't
 *  found (e.g. not yet loaded) — both rules default to "supported" in that case. */

/** The IP-Adapter "style" mode only works on SD 1.5 / SDXL. */
export const supportsStyleTransfer = (family: string | undefined): boolean =>
  family === "SD 1.5" || family === "SDXL";

/** Real strength-controlled img2img (reference image) works on every family EXCEPT
 *  FLUX.2 — it has no `strength` param, so its reference conditioning lives in /edit. */
export const supportsImg2img = (family: string | undefined): boolean =>
  family !== "FLUX.2";

/** Flow-matching families (FLUX / SD 3.x / Z-Image / FLUX.2) keep their native
 *  scheduler, so the sampler selection has no effect on them. */
export const supportsSamplerChoice = (family: string | undefined): boolean =>
  family !== "FLUX" && family !== "SD 3.x" && family !== "Z-Image" && family !== "FLUX.2";

/** LoRA family of an edit engine, derived from its repo id (mirrors the backend
 *  `quantize.engine_family`): FLUX.2 klein → "FLUX.2", a FLUX.1 Kontext edit engine →
 *  "FLUX". `undefined` when no LoRA-capable family applies (so the picker hides). */
export const engineLoraFamily = (
  engine: { repo_id: string; kind: string } | null | undefined,
): string | undefined => {
  if (!engine) return undefined;
  const repo = engine.repo_id.toLowerCase();
  if (repo.includes("flux.2") || repo.includes("flux2")) return "FLUX.2";
  if (engine.kind === "edit" || repo.includes("flux")) return "FLUX";
  return undefined;
};
