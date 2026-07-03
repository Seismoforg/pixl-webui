"use client";

import { useAppData } from "@/app-shell/AppChrome";
import { GenerationPanel } from "@/components/organisms/GenerationPanel";

export default function GeneratePage() {
  const { models } = useAppData();
  return <GenerationPanel models={models} />;
}
