"use client";

import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";

import { PromptSnippets } from "@/components/organisms/PromptSnippets";
import type { PromptKind, PromptSnippet } from "@/types";

interface SnippetPromptFieldProps {
  kind: PromptKind;
  snippets: PromptSnippet[];
  value: string;
  onChange: (text: string) => void;
  /** Append a chosen snippet to the current value. */
  onAppend: (snippet: string) => void;
  onSnippetsChanged: () => void;
  label: string;
  helperText: string;
}

/**
 * A multiline prompt field with a `PromptSnippets` control docked above it —
 * the upscaler-prompt and outpaint-prompt inputs share this exact shape.
 */
export const SnippetPromptField = ({
  kind,
  snippets,
  value,
  onChange,
  onAppend,
  onSnippetsChanged,
  label,
  helperText,
}: SnippetPromptFieldProps) => {
  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
        <PromptSnippets
          kind={kind}
          snippets={snippets}
          currentText={value}
          onApply={onAppend}
          onChanged={onSnippetsChanged}
        />
      </Box>
      <TextField
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        helperText={helperText}
        multiline
        minRows={2}
        fullWidth
      />
    </Box>
  );
};
