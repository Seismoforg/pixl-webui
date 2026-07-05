"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useAppData } from "@/providers/AppDataProvider";
import { ReframePanel } from "@/components/organisms/ReframePanel";

const ReframePageInner = () => {
  const { galleryToken } = useAppData();
  const params = useSearchParams();
  return (
    <ReframePanel
      reloadToken={galleryToken}
      initialImageId={params.get("image")}
    />
  );
};

const ReframePage = () => {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <ReframePageInner />
    </Suspense>
  );
};

export default ReframePage;
