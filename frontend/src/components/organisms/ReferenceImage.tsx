"use client";

import CloseIcon from "@mui/icons-material/Close";
import UploadIcon from "@mui/icons-material/Upload";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { SourceInfo } from "@/components/molecules/SourceInfo";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { useGeneration } from "@/providers/GenerationProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { GalleryImage } from "@/types";

interface ReferenceImageProps {
  // Whether the selected model supports the IP-Adapter "style" mode (SD 1.5/SDXL).
  styleSupported: boolean;
}

/**
 * Optional reference-image conditioning: upload an image and either make
 * variations of it (img2img) or borrow its style (IP-Adapter). Reads/writes the
 * generation context so the choice survives navigation like the other fields.
 */
export const ReferenceImage = ({ styleSupported }: ReferenceImageProps) => {
  const t = useTranslations();
  const gen = useGeneration();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Full-res size of the current reference, read from the loaded preview <img>.
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // If the model can't do style, don't leave the form stuck in that mode.
  useEffect(() => {
    if (!styleSupported && gen.referenceMode === "style") {
      gen.setReferenceMode("img2img");
    }
  }, [styleSupported, gen]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      gen.setReferenceImage(reader.result as string);
      gen.setReferenceMeta(null);
    };
    reader.readAsDataURL(file);
  };

  // Use a gallery image as the reference: fetch its file and store it as a data URL
  // (like an upload) so the generation request is unchanged; keep its metadata.
  const onPickGallery = async (img: GalleryImage) => {
    setPickerOpen(false);
    const res = await fetch(api.imageFileUrl(img.id));
    const blob = await res.blob();
    const reader = new FileReader();
    reader.onload = () => {
      gen.setReferenceImage(reader.result as string);
      gen.setReferenceMeta(img);
    };
    reader.readAsDataURL(blob);
  };

  const onRemove = () => {
    gen.setReferenceImage(null);
    gen.setReferenceMeta(null);
    setDims(null);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1.5 }}>
        <SectionHeading level={3}>{t("generate.reference.title")}</SectionHeading>
        <InfoTip text={t("generate.reference.info.title")} sx={{ fontSize: 16 }} />
      </Box>

      {gen.referenceImage === null ? (
        <Stack direction="row" spacing={1}>
          <Button component="label" variant="outlined" startIcon={<UploadIcon />} size="small">
            {t("generate.reference.upload")}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </Button>
          <Button variant="outlined" size="small" onClick={() => setPickerOpen(true)}>
            {t("generate.reference.fromGallery")}
          </Button>
        </Stack>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Box
              component="img"
              src={gen.referenceImage}
              alt={t("generate.reference.title")}
              onLoad={(e) =>
                setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
              }
              sx={{ width: 88, height: 88, objectFit: "cover", borderRadius: 1 }}
            />
            <Tooltip title={t("generate.reference.remove")}>
              <IconButton
                size="small"
                onClick={onRemove}
                aria-label={t("generate.reference.remove")}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          <SourceInfo dimensions={dims} meta={gen.referenceMeta} />

          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={gen.referenceMode}
              onChange={(_, v) => v && gen.setReferenceMode(v)}
            >
              <ToggleButton value="img2img">{t("generate.reference.modeImg2img")}</ToggleButton>
              <ToggleButton value="style" disabled={!styleSupported}>
                {t("generate.reference.modeStyle")}
              </ToggleButton>
            </ToggleButtonGroup>
            <InfoTip text={t("generate.reference.info.mode")} />
          </Box>

          {!styleSupported && (
            <Typography variant="caption" color="text.secondary">
              {t("generate.reference.styleUnsupported")}
            </Typography>
          )}

          {gen.referenceMode === "img2img" ? (
            <LabeledSlider
              label={t("generate.reference.strength")}
              value={gen.strength}
              min={0.05}
              max={1}
              step={0.05}
              info={t("generate.reference.info.strength")}
              onChange={gen.setStrength}
            />
          ) : (
            <LabeledSlider
              label={t("generate.reference.styleStrength")}
              value={gen.ipAdapterScale}
              min={0}
              max={1}
              step={0.05}
              info={t("generate.reference.info.styleStrength")}
              onChange={gen.setIpAdapterScale}
            />
          )}
        </Box>
      )}

      <GalleryPicker
        open={pickerOpen}
        reloadToken={0}
        onClose={() => setPickerOpen(false)}
        onPick={onPickGallery}
      />
    </Box>
  );
}
