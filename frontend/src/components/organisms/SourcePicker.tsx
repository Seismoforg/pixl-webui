"use client";

import UploadIcon from "@mui/icons-material/Upload";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Image from "next/image";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { SourceInfo } from "@/components/molecules/SourceInfo";
import { useTranslations } from "@/i18n";
import type { GalleryImage } from "@/types";

interface SourcePickerProps {
  /** Preview URL (a `data:` upload or an optimizable gallery URL), or null. */
  preview: string | null;
  /** Full-resolution source size for the readout. */
  dims: { w: number; h: number } | null;
  /** Gallery metadata for the readout (null for uploads). */
  meta: GalleryImage | null;
  onPickFromGallery: () => void;
  onUpload: (file: File | undefined) => void;
  onUploadDims: (dims: { w: number; h: number }) => void;
}

/** Upscale source picker: gallery/upload buttons, the source preview and a
 * SourceInfo readout. Presentational — state lives in UpscalePanel. */
export const SourcePicker = ({
  preview,
  dims,
  meta,
  onPickFromGallery,
  onUpload,
  onUploadDims,
}: SourcePickerProps) => {
  const t = useTranslations();
  return (
    <Box>
      <SectionHeading level={3} sx={{ mb: 1.5 }}>
        {t("upscale.source.title")}
      </SectionHeading>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Button variant="outlined" onClick={onPickFromGallery}>
          {t("upscale.source.fromGallery")}
        </Button>
        <Button component="label" role={undefined} variant="outlined" startIcon={<UploadIcon />}>
          {t("upscale.source.upload")}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </Button>
      </Stack>
      {preview ? (
        preview.startsWith("data:") ? (
          // Uploaded preview is a local data URL — the optimizer can't process it,
          // so render it directly.
          // eslint-disable-next-line @next/next/no-img-element
          <Box
            component="img"
            src={preview}
            alt={t("upscale.source.title")}
            onLoad={(e) => {
              const img = e.currentTarget;
              onUploadDims({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            sx={{ maxWidth: "100%", maxHeight: 220, borderRadius: 1, display: "block" }}
          />
        ) : (
          <Image
            src={preview}
            alt={t("upscale.source.title")}
            width={0}
            height={0}
            sizes="(max-width: 600px) 90vw, 400px"
            style={{
              width: "auto",
              height: "auto",
              maxWidth: "100%",
              maxHeight: 220,
              borderRadius: 4,
              display: "block",
              objectFit: "contain",
            }}
          />
        )
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t("upscale.source.none")}
        </Typography>
      )}
      <SourceInfo dimensions={dims} meta={meta} />
    </Box>
  );
};
