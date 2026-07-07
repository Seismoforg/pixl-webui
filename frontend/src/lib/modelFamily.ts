/** Capability rules that vary by generation-model family. Mirrors the
 *  families defined in `backend/app/catalog.py` ("SD 1.5" | "SDXL" | "FLUX" |
 *  "SD 3.x" | "Z-Image"). `family` is `undefined` when the model isn't found (e.g.
 *  not yet loaded) — both rules default to "supported" in that case. */

/** The IP-Adapter "style" mode only works on SD 1.5 / SDXL. */
export const supportsStyleTransfer = (family: string | undefined): boolean =>
  family === "SD 1.5" || family === "SDXL";

/** Flow-matching families (FLUX / SD 3.x / Z-Image) keep their native scheduler,
 *  so the sampler selection has no effect on them. */
export const supportsSamplerChoice = (family: string | undefined): boolean =>
  family !== "FLUX" && family !== "SD 3.x" && family !== "Z-Image";
