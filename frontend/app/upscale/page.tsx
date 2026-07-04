"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useAppData } from "@/providers/AppDataProvider";
import { UpscalePanel } from "@/components/organisms/UpscalePanel";

const UpscalePageInner = () => {
  const { galleryToken } = useAppData();
  const params = useSearchParams();
  return (
    <UpscalePanel
      reloadToken={galleryToken}
      initialImageId={params.get("image")}
    />
  );
}

const UpscalePage = () => {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <UpscalePageInner />
    </Suspense>
  );
}

export default UpscalePage;
