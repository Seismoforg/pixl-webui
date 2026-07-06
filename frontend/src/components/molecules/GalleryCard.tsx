"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DeleteIcon from "@mui/icons-material/Delete";
import ReplayIcon from "@mui/icons-material/Replay";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { MonoText } from "@/components/atoms/MonoText";
import { Thumbnail } from "@/components/molecules/Thumbnail";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { GalleryImage } from "@/types";

interface GalleryCardProps {
  image: GalleryImage;
  onOpen: (image: GalleryImage) => void;
  onRegenerate: (image: GalleryImage) => void;
  onUpscale: (image: GalleryImage) => void;
  onDelete: (image: GalleryImage) => void;
}

export const GalleryCard = ({ image, onOpen, onRegenerate, onUpscale, onDelete }: GalleryCardProps) => {
  const t = useTranslations();

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <Thumbnail
        src={api.imageFileUrl(image.id)}
        alt={image.prompt}
        sizes="(max-width: 600px) 50vw, 260px"
        onClick={() => onOpen(image)}
        role="button"
        tabIndex={0}
        ariaLabel={t("gallery.details")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(image);
          }
        }}
        sx={{
          cursor: "pointer",
          "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
        }}
      />
      <Stack spacing={1} sx={{ p: 1.5, flexGrow: 1 }}>
        <Typography
          variant="body2"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {image.prompt}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          <Chip label={image.model_name} size="small" variant="outlined" />
          <Chip
            label={
              <>
                {t("gallery.seed")} <MonoText>{image.seed}</MonoText>
              </>
            }
            size="small"
            variant="outlined"
          />
          <Chip
            label={<MonoText>{`${image.width}×${image.height}`}</MonoText>}
            size="small"
            variant="outlined"
          />
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ mt: "auto", pt: 0.5 }}>
          <Tooltip title={t("gallery.regenerate")}>
            <IconButton
              size="small"
              color="primary"
              onClick={() => onRegenerate(image)}
              aria-label={t("gallery.regenerate")}
            >
              <ReplayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("gallery.upscale")}>
            <IconButton
              size="small"
              color="primary"
              onClick={() => onUpscale(image)}
              aria-label={t("gallery.upscale")}
            >
              <AutoAwesomeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("gallery.delete")}>
            <IconButton
              size="small"
              color="error"
              onClick={() => onDelete(image)}
              aria-label={t("gallery.delete")}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
    </Paper>
  );
}
