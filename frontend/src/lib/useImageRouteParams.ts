"use client";

import { useSearchParams } from "next/navigation";

import { useAppData } from "@/providers/AppDataProvider";

/**
 * Shared glue for the four image-editing routes (upscale/reframe/inpaint/edit):
 * the gallery reload token plus an optional `?image=` id to prefill from. Must
 * be called from a component rendered inside a `<Suspense>` boundary, since
 * `useSearchParams` requires one in the App Router.
 */
export const useImageRouteParams = () => {
  const { galleryToken } = useAppData();
  const params = useSearchParams();
  return { reloadToken: galleryToken, initialImageId: params.get("image") };
};
