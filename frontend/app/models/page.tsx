"use client";

import { useAppData } from "@/providers/AppDataProvider";
import { EngineManager } from "@/components/organisms/EngineManager";
import { ModelManager } from "@/components/organisms/ModelManager";

const ModelsPage = () => {
  const { models, modelsLoading, reloadModels } = useAppData();
  return (
    <>
      <ModelManager models={models} loading={modelsLoading} onChanged={reloadModels} />
      <EngineManager />
    </>
  );
}

export default ModelsPage;
