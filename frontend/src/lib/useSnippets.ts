import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { PromptSnippet } from "@/types";

// Load the prompt-snippet list + expose a reload (passed to SnippetPromptField's
// onSnippetsChanged). Shared by the reframe/inpaint/upscale panels — identical in each.
export const useSnippets = (): { snippets: PromptSnippet[]; reloadSnippets: () => void } => {
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);

  const reloadSnippets = useCallback(() => {
    api
      .getPromptSnippets()
      .then(setSnippets)
      .catch(() => setSnippets([]));
  }, []);

  useEffect(() => {
    reloadSnippets();
  }, [reloadSnippets]);

  return { snippets, reloadSnippets };
};
