"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { GalleryImage, UpscaleSource } from "@/types";

interface UseImageSourceResult {
  /** Gallery metadata for the current source (full-res size + seed/prompt/model), null for uploads. */
  sourceMeta: GalleryImage | null;
  setUploadDims: (dims: { w: number; h: number }) => void;
  /** Preview URL: the gallery file URL or the upload's data URL. */
  sourcePreview: string | null;
  /** Full-res size: from metadata for a gallery image, from the loaded <img> for an upload. */
  sourceDims: { w: number; h: number } | null;
}

/**
 * Shared gallery-source-metadata + deep-link boilerplate for the 4 image-source
 * feature panels (Upscale/Reframe/Inpaint/Edit): preselects a gallery image passed
 * via `?image=<id>`, then loads its metadata (full-res size + seed/prompt/model) —
 * covering both the picker and the deep-link path. Upload size comes from the
 * loaded <img> instead (uploads carry no metadata).
 */
export const useImageSource = (
  source: UpscaleSource | null,
  setSource: (v: UpscaleSource | null) => void,
  initialImageId?: string | null,
): UseImageSourceResult => {
  const [sourceMeta, setSourceMeta] = useState<GalleryImage | null>(null);
  const [uploadDims, setUploadDims] = useState<{ w: number; h: number } | null>(null);

  // Preselect a gallery image passed via the deep-link (?image=<id>).
  useEffect(() => {
    if (initialImageId) {
      setSource({ kind: "gallery", imageId: initialImageId, preview: api.imageFileUrl(initialImageId) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImageId]);

  // Load the gallery source's metadata. Covers both the picker and the deep-link
  // path. Reset the upload size on every change.
  useEffect(() => {
    setUploadDims(null);
    if (source?.kind === "gallery") {
      let active = true;
      api
        .getImage(source.imageId)
        .then((m) => active && setSourceMeta(m))
        .catch(() => active && setSourceMeta(null));
      return () => {
        active = false;
      };
    }
    setSourceMeta(null);
    return undefined;
  }, [source]);

  const sourcePreview =
    source?.kind === "gallery" ? source.preview : source?.kind === "upload" ? source.dataUrl : null;

  const sourceDims =
    source?.kind === "gallery"
      ? sourceMeta
        ? { w: sourceMeta.width, h: sourceMeta.height }
        : null
      : uploadDims;

  return { sourceMeta, setUploadDims, sourcePreview, sourceDims };
};
