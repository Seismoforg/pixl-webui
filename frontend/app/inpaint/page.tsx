"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useAppData } from "@/providers/AppDataProvider";
import { InpaintPanel } from "@/components/organisms/InpaintPanel";

const InpaintPageInner = () => {
  const { galleryToken } = useAppData();
  const params = useSearchParams();
  return <InpaintPanel reloadToken={galleryToken} initialImageId={params.get("image")} />;
};

const InpaintPage = () => {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <InpaintPageInner />
    </Suspense>
  );
};

export default InpaintPage;
