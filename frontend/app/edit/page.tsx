"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useAppData } from "@/providers/AppDataProvider";
import { EditPanel } from "@/components/organisms/EditPanel";

const EditPageInner = () => {
  const { galleryToken } = useAppData();
  const params = useSearchParams();
  return <EditPanel reloadToken={galleryToken} initialImageId={params.get("image")} />;
};

const EditPage = () => {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <EditPageInner />
    </Suspense>
  );
};

export default EditPage;
