"use client";

import Stack from "@mui/material/Stack";

import { useAppData } from "@/providers/AppDataProvider";
import { CuratedEnginesEditor } from "@/components/organisms/CuratedEnginesEditor";
import { CuratedLorasEditor } from "@/components/organisms/CuratedLorasEditor";
import { CuratedModelsEditor } from "@/components/organisms/CuratedModelsEditor";
import { PromptSnippetManager } from "@/components/organisms/PromptSnippetManager";
import { SettingsPanel } from "@/components/organisms/SettingsPanel";

const SettingsPage = () => {
  const { system } = useAppData();
  return (
    <Stack spacing={3}>
      <SettingsPanel system={system} />
      <CuratedModelsEditor />
      <CuratedEnginesEditor />
      <CuratedLorasEditor />
      <PromptSnippetManager />
    </Stack>
  );
}

export default SettingsPage;
