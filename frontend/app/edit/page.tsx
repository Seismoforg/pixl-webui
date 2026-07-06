"use client";

import { useTheme } from "@mui/material/styles";
import { Suspense } from "react";

import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { EditPanel } from "@/components/organisms/EditPanel";
import { useImageRouteParams } from "@/lib/useImageRouteParams";

const EditPageInner = () => {
  const { reloadToken, initialImageId } = useImageRouteParams();
  return <EditPanel reloadToken={reloadToken} initialImageId={initialImageId} />;
};

const EditPage = () => {
  const theme = useTheme();
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingIndicator minHeight={theme.layout.resultMinHeight} />}>
      <EditPageInner />
    </Suspense>
  );
};

export default EditPage;
