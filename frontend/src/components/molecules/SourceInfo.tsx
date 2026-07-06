"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { MonoText } from "@/components/atoms/MonoText";
import { useTranslations } from "@/i18n";
import type { GalleryImage } from "@/types";

interface SourceInfoProps {
  /** FULL image size (from metadata / natural upload size), NOT the rendered
   *  thumbnail — the preview is downscaled by next/image. */
  dimensions: { w: number; h: number } | null;
  meta: GalleryImage | null;
  /** Compact variant for the gallery-picker tiles. */
  dense?: boolean;
}

/** Compact facts about a source image: resolution always, plus model / seed /
 *  prompt when it comes from the gallery. Shared by the upscale source preview and
 *  the gallery-picker tiles (mirrors GalleryCard's chip + truncated-prompt style). */
export const SourceInfo = ({ dimensions, meta, dense = false }: SourceInfoProps) => {
  const t = useTranslations();
  if (!dimensions && !meta) return null;

  return (
    <Stack spacing={0.5} sx={{ mt: dense ? 0.5 : 1 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {dimensions && (
          <Chip
            label={<MonoText>{`${dimensions.w}×${dimensions.h}`}</MonoText>}
            size="small"
            variant="outlined"
          />
        )}
        {meta && <Chip label={meta.model_name} size="small" variant="outlined" />}
        {meta && (
          <Chip
            label={
              <>
                {t("gallery.seed")} <MonoText>{meta.seed}</MonoText>
              </>
            }
            size="small"
            variant="outlined"
          />
        )}
      </Box>
      {meta?.prompt && (
        <Typography
          variant="caption"
          color="text.secondary"
          title={meta.prompt}
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: dense ? 1 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {meta.prompt}
        </Typography>
      )}
    </Stack>
  );
};
