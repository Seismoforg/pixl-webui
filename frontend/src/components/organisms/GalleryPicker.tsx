"use client";

import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { SourceInfo } from "@/components/molecules/SourceInfo";
import { Thumbnail } from "@/components/molecules/Thumbnail";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { GalleryImage } from "@/types";

interface GalleryPickerProps {
  open: boolean;
  reloadToken: number;
  onClose: () => void;
  onPick: (image: GalleryImage) => void;
}

/** Modal grid of stored gallery images; used to pick an upscale source. */
export const GalleryPicker = ({ open, reloadToken, onClose, onPick }: GalleryPickerProps) => {
  const t = useTranslations();
  const [images, setImages] = useState<GalleryImage[]>([]);

  // Refetch whenever the picker opens or the gallery changes (reloadToken bump),
  // so newly generated images show up instead of a stale first-open snapshot.
  useEffect(() => {
    if (!open) return;
    api.getImages().then(setImages).catch(() => setImages([]));
  }, [open, reloadToken]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t("upscale.picker.title")}</DialogTitle>
      <DialogContent dividers>
        {images.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("upscale.picker.empty")}
          </Typography>
        ) : (
          <Box
            sx={{
              display: "grid",
              gap: 1.5,
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            }}
          >
            {images.map((img) => (
              <Box key={img.id}>
                <Thumbnail
                  src={api.imageFileUrl(img.id)}
                  alt={img.prompt}
                  sizes="150px"
                  onClick={() => onPick(img)}
                  sx={{
                    borderRadius: 1,
                    cursor: "pointer",
                    "&:hover": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
                  }}
                />
                <SourceInfo dense dimensions={{ w: img.width, h: img.height }} meta={img} />
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};
