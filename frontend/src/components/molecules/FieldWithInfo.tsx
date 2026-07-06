"use client";

import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

import { InfoTip } from "@/components/molecules/InfoTip";

interface FieldWithInfoProps {
  info: string;
  align?: "center" | "flex-start";
  infoSx?: SxProps<Theme>;
  sx?: SxProps<Theme>;
  children: ReactNode;
}

/**
 * Flex row pairing a form field (passed as `children`, unchanged) with its
 * InfoTip button. Extracted from `GenerationForm`, which repeated this exact
 * Box+field+InfoTip wrapper across its model/prompt/sampler/size/seed rows.
 */
export const FieldWithInfo = ({ info, align = "center", infoSx, sx, children }: FieldWithInfoProps) => (
  <Box sx={{ display: "flex", alignItems: align, gap: 0.5, ...sx }}>
    {children}
    <InfoTip text={info} sx={infoSx} />
  </Box>
);
