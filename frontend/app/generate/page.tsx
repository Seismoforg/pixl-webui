"use client";

import { useAppData } from "@/providers/AppDataProvider";
import { GenerationPanel } from "@/components/organisms/GenerationPanel";

const GeneratePage = () => {
  const { models } = useAppData();
  return <GenerationPanel models={models} />;
}

export default GeneratePage;
