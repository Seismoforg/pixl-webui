"use client";

import Stack from "@mui/material/Stack";

import { useAppData } from "@/app-shell/AppChrome";
import { PromptSnippetManager } from "@/components/organisms/PromptSnippetManager";
import { SettingsPanel } from "@/components/organisms/SettingsPanel";

const SettingsPage = () => {
  const { system } = useAppData();
  return (
    <Stack spacing={3}>
      <SettingsPanel system={system} />
      <PromptSnippetManager />
    </Stack>
  );
}

export default SettingsPage;
