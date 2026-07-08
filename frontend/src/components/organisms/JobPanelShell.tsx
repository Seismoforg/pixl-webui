"use client";

import ClearIcon from "@mui/icons-material/Clear";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { ReactNode } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { formCardSx } from "@/lib/formCard";
import { formLockStyle } from "@/lib/formLock";
import { stickyActionBarSx } from "@/lib/stickyActionBar";

interface JobPanelShellProps {
  title: string;
  /** Final display error (the panel derives it); null hides the alert. */
  error: string | null;
  /** When set, replaces the form/result grid (compare's loading/empty gates). */
  gate?: ReactNode;
  running: boolean;
  runIcon?: ReactNode;
  runLabel: string;
  runningLabel: string;
  onRun: () => void;
  /** Complete disabled condition incl. `running` where wanted (panel-owned). */
  runDisabled: boolean;
  /** Clear button renders only when onClear is given. */
  onClear?: () => void;
  clearLabel?: string;
  clearDisabled?: boolean;
  /** Extra content between the locked fields and the action bar (compare's cell count). */
  beforeActions?: ReactNode;
  /** The right column (sticky result panel). */
  result: ReactNode;
  /** Modals rendered outside the grid (GalleryPicker). */
  after?: ReactNode;
  /** Form fields, rendered inside the run-locked fieldset. */
  children: ReactNode;
}

/**
 * The shared page shell of the job panels (compare/upscale/reframe/inpaint/edit):
 * heading + error alert + the two-column grid holding the form card (run-locked
 * fieldset + sticky Run/Clear action bar) and the sticky result column.
 */
export const JobPanelShell = ({
  title,
  error,
  gate,
  running,
  runIcon,
  runLabel,
  runningLabel,
  onRun,
  runDisabled,
  onClear,
  clearLabel,
  clearDisabled,
  beforeActions,
  result,
  after,
  children,
}: JobPanelShellProps) => (
  <Box>
    <SectionHeading level={2} sx={{ mb: 2 }}>
      {title}
    </SectionHeading>

    {error && (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    )}

    {gate ?? (
      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          alignItems: "start",
        }}
      >
        <Stack spacing={3} sx={formCardSx}>
          {/* Lock the controls while a job runs (see formLockStyle). */}
          <fieldset disabled={running} style={formLockStyle(running)}>
            <Stack spacing={3}>{children}</Stack>
          </fieldset>

          {beforeActions}

          <Stack direction="row" spacing={1} sx={stickyActionBarSx}>
            <Button
              variant="contained"
              size="large"
              startIcon={runIcon}
              onClick={onRun}
              disabled={runDisabled}
              sx={{ flexGrow: 1 }}
            >
              {running ? runningLabel : runLabel}
            </Button>
            {onClear && (
              <Button
                variant="outlined"
                size="large"
                startIcon={<ClearIcon />}
                onClick={onClear}
                disabled={clearDisabled}
              >
                {clearLabel}
              </Button>
            )}
          </Stack>
        </Stack>

        {result}
      </Box>
    )}

    {after}
  </Box>
);
