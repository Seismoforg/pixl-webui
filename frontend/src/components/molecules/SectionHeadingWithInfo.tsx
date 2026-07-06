"use client";

import Box from "@mui/material/Box";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";

interface SectionHeadingWithInfoProps {
  title: string;
  help: string;
}

/** Sub-section header: an h3 title paired with an InfoTip, shared by the
 *  generation-params and brush-controls panels. */
export const SectionHeadingWithInfo = ({ title, help }: SectionHeadingWithInfoProps) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
    <SectionHeading level={3} variant="subtitle2">
      {title}
    </SectionHeading>
    <InfoTip text={help} sx={{ fontSize: 16 }} />
  </Box>
);
