"use client";

import { useTheme } from "@mui/material/styles";
import { Suspense } from "react";

import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { UpscalePanel } from "@/components/organisms/UpscalePanel";
import { useImageRouteParams } from "@/lib/useImageRouteParams";

const UpscalePageInner = () => {
  const { reloadToken, initialImageId } = useImageRouteParams();
  return <UpscalePanel reloadToken={reloadToken} initialImageId={initialImageId} />;
}

const UpscalePage = () => {
  const theme = useTheme();
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingIndicator minHeight={theme.layout.resultMinHeight} />}>
      <UpscalePageInner />
    </Suspense>
  );
}

export default UpscalePage;
