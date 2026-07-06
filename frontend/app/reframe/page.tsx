"use client";

import { useTheme } from "@mui/material/styles";
import { Suspense } from "react";

import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { ReframePanel } from "@/components/organisms/ReframePanel";
import { useImageRouteParams } from "@/lib/useImageRouteParams";

const ReframePageInner = () => {
  const { reloadToken, initialImageId } = useImageRouteParams();
  return <ReframePanel reloadToken={reloadToken} initialImageId={initialImageId} />;
};

const ReframePage = () => {
  const theme = useTheme();
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingIndicator minHeight={theme.layout.resultMinHeight} />}>
      <ReframePageInner />
    </Suspense>
  );
};

export default ReframePage;
