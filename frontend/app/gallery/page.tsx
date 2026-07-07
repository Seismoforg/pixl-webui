"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { useAppData } from "@/providers/AppDataProvider";
import { GalleryPanel } from "@/components/organisms/GalleryPanel";
import { useGeneration } from "@/providers/GenerationProvider";
import type { GalleryImage } from "@/types";

const GalleryPage = () => {
  const gen = useGeneration();
  const { galleryToken } = useAppData();
  const router = useRouter();

  const onRegenerate = useCallback(
    (image: GalleryImage) => {
      gen.applyPrefill(image);
      router.push("/generate");
    },
    [gen, router],
  );

  const onUpscale = useCallback(
    (image: GalleryImage) => {
      router.push(`/upscale?image=${encodeURIComponent(image.id)}`);
    },
    [router],
  );

  return (
    <GalleryPanel onRegenerate={onRegenerate} onUpscale={onUpscale} reloadToken={galleryToken} />
  );
};

export default GalleryPage;
