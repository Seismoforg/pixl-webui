"use client";

import MemoryIcon from "@mui/icons-material/Memory";
import StorageIcon from "@mui/icons-material/Storage";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { useMemo } from "react";

import {
  CatalogEditor,
  type CatalogDisplay,
  type CatalogRuntime,
  type FieldSpec,
} from "@/components/organisms/CatalogEditor";
import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { fitChipMeta, fitRank } from "@/lib/fit";
import type { EngineCatalogEntry } from "@/types";

const EMPTY: EngineCatalogEntry = {
  slug: "",
  kind: "realesrgan",
  name: "",
  description: "",
  repo_id: "",
  filename: null,
  scale: 4,
  approx_size_gb: 0,
  min_vram_gb: 4,
  prompt_capable: false,
  variant: null,
  use_safetensors: true,
  gguf_repo_id: null,
  gguf_filename: null,
  defaults: { steps: 28, guidance_scale: 7.5, refine_steps: 8 },
};

/** Settings section to edit the curated upscale/outpaint engine catalog (JSON-backed). */
export const CuratedEnginesEditor = () => {
  const t = useTranslations();
  const downloads = useDownloads();

  const fields = useMemo<FieldSpec[]>(() => {
    const f = (key: string) => t(`settings.catalog.fields.${key}`);
    return [
      { key: "slug", label: f("slug"), type: "text" },
      { key: "name", label: f("name"), type: "text" },
      {
        key: "kind",
        label: f("kind"),
        type: "select",
        options: [
          { value: "realesrgan", label: t("engines.kind.realesrgan") },
          { value: "sd_x4", label: t("engines.kind.sd_x4") },
          { value: "inpaint", label: t("engines.kind.inpaint") },
          { value: "edit", label: t("engines.kind.edit") },
        ],
      },
      { key: "repo_id", label: f("repoId"), type: "text" },
      { key: "description", label: f("description"), type: "multiline" },
      { key: "filename", label: f("filename"), type: "text", nullable: true },
      { key: "scale", label: f("scale"), type: "number", min: 1, step: 1 },
      { key: "approx_size_gb", label: f("sizeGb"), type: "number", min: 0, step: 0.1 },
      { key: "min_vram_gb", label: f("vramGb"), type: "number", min: 0, step: 0.5 },
      { key: "prompt_capable", label: f("promptCapable"), type: "boolean" },
      { key: "use_safetensors", label: f("useSafetensors"), type: "boolean" },
      { key: "variant", label: f("variant"), type: "text", nullable: true },
      { key: "gguf_repo_id", label: f("ggufRepoId"), type: "text", nullable: true },
      { key: "gguf_filename", label: f("ggufFilename"), type: "text", nullable: true },
      { key: "defaults.steps", label: f("steps"), type: "number", min: 0, step: 1 },
      { key: "defaults.guidance_scale", label: f("guidance"), type: "number", min: 0, step: 0.5 },
      { key: "defaults.refine_steps", label: f("refineSteps"), type: "number", min: 0, step: 1 },
    ];
  }, [t]);

  const display: CatalogDisplay<EngineCatalogEntry> = {
    loadRuntime: api.getUpscalers,
    groupBy: (e) => t(`engines.kind.${e.kind}`),
    sortWithin: (a, b) =>
      Number(b.downloaded) - Number(a.downloaded) ||
      (a.fit ? fitRank[a.fit.verdict] : 0) - (b.fit ? fitRank[b.fit.verdict] : 0) ||
      a.name.localeCompare(b.name),
    renderBadges: (e) => renderEngineBadges(e, t),
    onDownload: (e) => trackUpscalerDownload(downloads.track, e, "/settings"),
    onDeleteDownload: (slug) => api.deleteUpscaler(slug).then(() => undefined),
  };

  return (
    <CatalogEditor<EngineCatalogEntry>
      title={t("settings.enginesCatalog.title")}
      description={t("settings.enginesCatalog.description")}
      fields={fields}
      load={api.getEnginesCatalog}
      save={api.saveEnginesCatalog}
      reset={api.resetEnginesCatalog}
      emptyEntry={EMPTY}
      primaryText={(e) => `${e.name || e.slug}`}
      secondaryText={(e) => `${t(`engines.kind.${e.kind}`)} · ${e.repo_id}`}
      display={display}
    />
  );
};

/** Metric chips for an engine row — kind / scale / size / VRAM / GPU-fit. */
const renderEngineBadges = (
  e: EngineCatalogEntry & CatalogRuntime,
  t: ReturnType<typeof useTranslations>,
) => {
  const fitMeta = e.fit ? fitChipMeta(e.fit.verdict) : null;
  return (
    <>
      <Chip label={t(`engines.kind.${e.kind}`)} size="small" color="primary" variant="outlined" />
      <Chip label={`${e.scale}×`} size="small" variant="outlined" />
      {e.approx_size_gb > 0 && (
        <Chip
          icon={<StorageIcon />}
          label={`${t("models.size")} ≈ ${e.approx_size_gb} GB`}
          size="small"
          variant="outlined"
        />
      )}
      <Chip
        icon={<MemoryIcon />}
        label={`${t("models.vram")} ≥ ${e.min_vram_gb} GB`}
        size="small"
        variant="outlined"
      />
      {fitMeta && e.fit && (
        <Tooltip
          title={t(fitMeta.tooltipKey, {
            vram: e.fit.est_vram_gb,
            total: e.fit.gpu_total_gb ?? "?",
          })}
        >
          <Chip label={t(fitMeta.labelKey)} size="small" color={fitMeta.color} variant="outlined" />
        </Tooltip>
      )}
    </>
  );
};
