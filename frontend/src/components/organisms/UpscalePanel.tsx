"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { EnginePicker } from "@/components/organisms/EnginePicker";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { JobPanelShell } from "@/components/organisms/JobPanelShell";
import { SnippetPromptField } from "@/components/organisms/SnippetPromptField";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { UpscaleResult } from "@/components/organisms/UpscaleResult";
import { useTranslations } from "@/i18n";
import { useEngineSelection } from "@/lib/useEngineSelection";
import { toImageRequest, useSourcePanel } from "@/lib/useImageSource";
import { useSnippets } from "@/lib/useSnippets";
import { useUpscale } from "@/providers/UpscaleProvider";

interface UpscalePanelProps {
  reloadToken: number;
  initialImageId?: string | null;
}

export const UpscalePanel = ({ reloadToken, initialImageId }: UpscalePanelProps) => {
  const t = useTranslations();
  // The upscale job AND the form (engine/source/prompt/tiling) live in a
  // persistent provider so they survive navigation and the off-route overlay can
  // read the same progress.
  const upscale = useUpscale();
  const {
    running,
    resultId,
    error: jobError,
    engineSlug,
    source,
    prompt,
    tile,
    sdX4Steps,
    fidelity,
    setEngineSlug,
    setSource,
    setPrompt,
    setTile,
    setSdX4Steps,
    setFidelity,
  } = upscale;

  const { snippets, reloadSnippets } = useSnippets();
  const src = useSourcePanel(source, setSource, initialImageId);

  // Only the actual upscaler kinds are selectable here: inpaint engines belong to the
  // Reframe/Inpaint pages and edit engines to Post Processing (the upscale service
  // rejects them at run time).
  const {
    engines: selectableEngines,
    selectedEngine,
    enginesLoading,
    enginesError,
    downloadPercent,
    startEngineDownload,
    error,
    setError,
  } = useEngineSelection({
    engine: engineSlug,
    setEngine: setEngineSlug,
    filter: (e) => ["realesrgan", "sd_x4", "face_restore"].includes(e.kind),
    route: "/upscale",
    errorKey: "upscale.error",
    settingsKey: (s) => s.default_upscaler,
    fallbackToFirst: false,
  });

  // CodeFormer face restoration has its own control (fidelity) and no tiling/prompt.
  const isFaceRestore = selectedEngine?.kind === "face_restore";

  const handleRun = () => {
    if (!selectedEngine || !source) return;
    setError(null);
    upscale.start({
      engine: selectedEngine.slug,
      ...toImageRequest(source),
      prompt,
      tile,
      sd_x4_steps: selectedEngine.kind === "sd_x4" ? sdX4Steps : null,
      fidelity: isFaceRestore ? fidelity : null,
    });
  };

  const handleClear = () => {
    setSource(null);
    setPrompt("");
    setError(null);
    upscale.reset();
  };

  const displayError = error ?? jobError ?? (enginesError ? t("upscale.engineLoadError") : null);

  return (
    <JobPanelShell
      title={t("upscale.title")}
      error={displayError}
      running={running}
      runIcon={<AutoAwesomeIcon />}
      runLabel={t("upscale.run")}
      runningLabel={t("upscale.running")}
      onRun={handleRun}
      runDisabled={!selectedEngine || !selectedEngine.downloaded || !source || running}
      onClear={handleClear}
      clearLabel={t("upscale.clear")}
      clearDisabled={running || (!source && !prompt && !resultId)}
      result={<UpscaleResult />}
      after={
        <GalleryPicker
          open={src.pickerOpen}
          reloadToken={reloadToken}
          onClose={src.closePicker}
          onPick={src.onPick}
        />
      }
    >
      <EnginePicker
        engine={selectedEngine}
        engines={selectableEngines}
        loading={enginesLoading}
        downloadPercent={downloadPercent}
        onSelect={setEngineSlug}
        onDownload={() => selectedEngine && startEngineDownload(selectedEngine)}
      />

      <SourcePicker {...src.sourcePickerProps} />

      {/* Upscaler prompt — guides the diffusion upscaler (SD x4) toward detail. */}
      {selectedEngine?.prompt_capable && (
        <SnippetPromptField
          kind="upscale"
          snippets={snippets.filter((s) => s.kind === "upscale")}
          value={prompt}
          onChange={setPrompt}
          onAppend={(text) => setPrompt(prompt ? `${prompt}, ${text}` : text)}
          onSnippetsChanged={reloadSnippets}
          label={t("upscale.prompt.label")}
          helperText={t("upscale.prompt.help")}
        />
      )}

      {/* SD x4 step count — per-run override of the global default. */}
      {selectedEngine?.kind === "sd_x4" && (
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
            <SectionHeading level={3} variant="subtitle2">
              {t("upscale.steps.label")}
            </SectionHeading>
            <InfoTip text={t("upscale.steps.help")} />
          </Box>
          <TextField
            type="number"
            size="small"
            value={sdX4Steps}
            onChange={(e) => setSdX4Steps(Number(e.target.value))}
            inputProps={{ min: 1, max: 150, step: 1 }}
            sx={{ maxWidth: 140 }}
          />
        </Box>
      )}

      {/* Fidelity — CodeFormer identity↔smoothness weight (face restoration). */}
      {isFaceRestore && (
        <LabeledSlider
          label={t("upscale.fidelity.label")}
          value={fidelity}
          min={0}
          max={1}
          step={0.05}
          info={t("upscale.fidelity.help")}
          onChange={setFidelity}
        />
      )}

      {/* Tiling option — not applicable to face restoration (no tiling). */}
      {!isFaceRestore && (
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
            <SectionHeading level={3} variant="subtitle2">
              {t("upscale.tiling.label")}
            </SectionHeading>
            <InfoTip text={t("upscale.tiling.help")} />
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={tile ? "auto" : "off"}
            onChange={(_, v) => v !== null && setTile(v === "auto")}
          >
            <ToggleButton value="auto">{t("upscale.tiling.auto")}</ToggleButton>
            <ToggleButton value="off">{t("upscale.tiling.off")}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      )}
    </JobPanelShell>
  );
};
