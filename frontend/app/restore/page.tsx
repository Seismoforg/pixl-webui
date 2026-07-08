"use client";

import { useTheme } from "@mui/material/styles";
import { Suspense } from "react";

import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { RestorePanel } from "@/components/organisms/RestorePanel";
import { useImageRouteParams } from "@/lib/useImageRouteParams";

const RestorePageInner = () => {
  const { reloadToken, initialImageId } = useImageRouteParams();
  return <RestorePanel reloadToken={reloadToken} initialImageId={initialImageId} />;
};

const RestorePage = () => {
  const theme = useTheme();
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingIndicator minHeight={theme.layout.resultMinHeight} />}>
      <RestorePageInner />
    </Suspense>
  );
};

export default RestorePage;
