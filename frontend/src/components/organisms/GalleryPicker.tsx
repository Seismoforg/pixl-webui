"use client";

import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";

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
  const loaded = useRef(false);

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
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
              // eslint-disable-next-line @next/next/no-img-element
              <Box
                key={img.id}
                component="img"
                src={api.imageFileUrl(img.id)}
                alt={img.prompt}
                loading="lazy"
                onClick={() => onPick(img)}
                sx={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  objectFit: "cover",
                  borderRadius: 1,
                  cursor: "pointer",
                  "&:hover": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
                }}
              />
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};
