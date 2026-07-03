"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { useAppData } from "@/app-shell/AppChrome";
import { GalleryPanel } from "@/components/organisms/GalleryPanel";
import { useGeneration } from "@/generation/GenerationProvider";
import type { GalleryImage } from "@/types";

export default function GalleryPage() {
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

  return <GalleryPanel onRegenerate={onRegenerate} reloadToken={galleryToken} />;
}
