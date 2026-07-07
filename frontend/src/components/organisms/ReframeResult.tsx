"use client";

import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import LayersIcon from "@mui/icons-material/Layers";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";

import { BatchImageResult } from "@/components/organisms/BatchImageResult";
import { ReframePreview } from "@/components/molecules/ReframePreview";
import { useTranslations } from "@/i18n";
import { useReframe } from "@/providers/ReframeProvider";

interface ReframeResultProps {
  /** Source preview URL + full-res size, for the layout preview (from ReframePanel). */
  preview: string | null;
  dims: { w: number; h: number } | null;
}

/** The reframe result column: the layout preview on top, then live stats while
 *  running, then the saved image(s) via the shared BatchImageResult. Outpaint can
 *  produce a batch of variants, shown as a selectable thumbnail grid. A toggle
 *  superimposes the layout preview over the result. */
export const ReframeResult = ({ preview, dims }: ReframeResultProps) => {
  const t = useTranslations();
  const {
    running,
    progress,
    resultIds,
    targetRatio,
    customWidth,
    customHeight,
    reframe: strategy,
    maskFeather,
    seamFeather,
    posX,
    posY,
    scale,
  } = useReframe();

  // In custom mode the dropdown value is the sentinel "custom"; the preview needs a
  // real aspect, so derive it from the typed W×H.
  const previewRatio = targetRatio === "custom" ? `${customWidth}:${customHeight}` : targetRatio;
  // Whether the layout preview is superimposed over the result image.
  const [showOverlay, setShowOverlay] = useState(false);

  const previewProps = {
    preview,
    dims,
    targetRatio: previewRatio,
    strategy,
    maskSoftness: maskFeather / 100,
    seamSoftness: seamFeather / 100,
    posX: posX / 100,
    posY: posY / 100,
    scale: strategy === "cover" ? 1 : scale / 100,
  };

  return (
    <BatchImageResult
      icon={AspectRatioIcon}
      keyPrefix="reframe.result"
      running={running}
      progress={progress}
      resultIds={resultIds}
      beforeContent={
        <Box sx={{ mb: 2 }}>
          <ReframePreview {...previewProps} />
        </Box>
      }
      renderImageOverlay={() => (
        <>
          {showOverlay && <ReframePreview overlay {...previewProps} />}
          {preview && dims && (
            <Tooltip
              title={t(showOverlay ? "reframe.result.hidePreview" : "reframe.result.showPreview")}
            >
              <IconButton
                size="small"
                onClick={() => setShowOverlay((v) => !v)}
                aria-pressed={showOverlay}
                aria-label={t(
                  showOverlay ? "reframe.result.hidePreview" : "reframe.result.showPreview",
                )}
                sx={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  bgcolor: "background.paper",
                  border: 1,
                  borderColor: "divider",
                  color: showOverlay ? "primary.main" : "text.secondary",
                  "&:hover": { bgcolor: "background.paper" },
                }}
              >
                <LayersIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </>
      )}
    />
  );
};
