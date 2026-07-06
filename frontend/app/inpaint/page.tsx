"use client";

import { useTheme } from "@mui/material/styles";
import { Suspense } from "react";

import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { InpaintPanel } from "@/components/organisms/InpaintPanel";
import { useImageRouteParams } from "@/lib/useImageRouteParams";

const InpaintPageInner = () => {
  const { reloadToken, initialImageId } = useImageRouteParams();
  return <InpaintPanel reloadToken={reloadToken} initialImageId={initialImageId} />;
};

const InpaintPage = () => {
  const theme = useTheme();
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingIndicator minHeight={theme.layout.resultMinHeight} />}>
      <InpaintPageInner />
    </Suspense>
  );
};

export default InpaintPage;
