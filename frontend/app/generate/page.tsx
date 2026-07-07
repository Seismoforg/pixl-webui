"use client";

import { useAppData } from "@/providers/AppDataProvider";
import { GenerationPanel } from "@/components/organisms/GenerationPanel";

const GeneratePage = () => {
  const { models, modelsLoading, modelsError } = useAppData();
  return <GenerationPanel models={models} loading={modelsLoading} error={modelsError} />;
};

export default GeneratePage;
