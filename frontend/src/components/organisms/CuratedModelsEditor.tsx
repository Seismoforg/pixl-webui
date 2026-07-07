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
import { useAppData } from "@/providers/AppDataProvider";
import { useDownloads } from "@/providers/DownloadProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { fitChipMeta, fitRank } from "@/lib/fit";
import type { ModelCatalogEntry } from "@/types";

const EMPTY: ModelCatalogEntry = {
  slug: "",
  repo_id: "",
  name: "",
  family: "SDXL",
  pipeline_tag: "text-to-image",
  description: "",
  gated: false,
  approx_size_gb: 0,
  min_vram_gb: 4,
  variant: null,
  use_safetensors: true,
  gguf_repo_id: null,
  gguf_filename: null,
  defaults: { steps: 30, guidance_scale: 7, width: 1024, height: 1024 },
};

/** Settings section to edit the curated generation-model catalog (JSON-backed). */
export const CuratedModelsEditor = () => {
  const t = useTranslations();
  const { reloadModels } = useAppData();
  const downloads = useDownloads();

  const fields = useMemo<FieldSpec[]>(() => {
    const f = (key: string) => t(`settings.catalog.fields.${key}`);
    return [
      { key: "slug", label: f("slug"), type: "text" },
      { key: "name", label: f("name"), type: "text" },
      { key: "repo_id", label: f("repoId"), type: "text" },
      {
        key: "family",
        label: f("family"),
        type: "select",
        // Mirrors backend/app/catalog.py's `family` comment (the only families
        // the pipeline loader / capability rules understand).
        options: [
          { value: "SD 1.5", label: "SD 1.5" },
          { value: "SDXL", label: "SDXL" },
          { value: "FLUX", label: "FLUX" },
          { value: "SD 3.x", label: "SD 3.x" },
        ],
      },
      // Free-form HuggingFace pipeline tag; every curated entry currently uses
      // "text-to-image" and no fixed enum is documented, so this stays text.
      { key: "pipeline_tag", label: f("pipelineTag"), type: "text" },
      { key: "description", label: f("description"), type: "multiline" },
      { key: "gated", label: f("gated"), type: "boolean" },
      { key: "use_safetensors", label: f("useSafetensors"), type: "boolean" },
      { key: "approx_size_gb", label: f("sizeGb"), type: "number", min: 0, step: 0.1 },
      { key: "min_vram_gb", label: f("vramGb"), type: "number", min: 0, step: 0.5 },
      { key: "variant", label: f("variant"), type: "text", nullable: true },
      { key: "gguf_repo_id", label: f("ggufRepoId"), type: "text", nullable: true },
      { key: "gguf_filename", label: f("ggufFilename"), type: "text", nullable: true },
      { key: "defaults.steps", label: f("steps"), type: "number", min: 1, step: 1 },
      { key: "defaults.guidance_scale", label: f("guidance"), type: "number", min: 0, step: 0.5 },
      { key: "defaults.width", label: f("width"), type: "number", min: 64, step: 64 },
      { key: "defaults.height", label: f("height"), type: "number", min: 64, step: 64 },
    ];
  }, [t]);

  const display: CatalogDisplay<ModelCatalogEntry> = {
    loadRuntime: api.getModels,
    groupBy: (m) => m.family,
    // Installed first, then best GPU-fit, then name — mirrors the Models page.
    sortWithin: (a, b) =>
      Number(b.downloaded) - Number(a.downloaded) ||
      (a.fit ? fitRank[a.fit.verdict] : 0) - (b.fit ? fitRank[b.fit.verdict] : 0) ||
      a.name.localeCompare(b.name),
    renderBadges: (m) => renderModelBadges(m, t),
    onDownload: async (m) => {
      await api.downloadModel(m.slug);
      downloads.track(m.slug, {
        title: m.name,
        route: "/settings",
        kind: "model",
        fetch: () => api.getProgress(m.slug),
        retry: () => api.downloadModel(m.slug),
      });
    },
    onDeleteDownload: async (slug) => {
      await api.deleteModel(slug);
      reloadModels();
    },
  };

  return (
    <CatalogEditor<ModelCatalogEntry>
      title={t("settings.modelsCatalog.title")}
      description={t("settings.modelsCatalog.description")}
      fields={fields}
      load={api.getModelsCatalog}
      save={api.saveModelsCatalog}
      reset={api.resetModelsCatalog}
      emptyEntry={EMPTY}
      primaryText={(m) => `${m.name || m.slug}`}
      secondaryText={(m) => `${m.family} · ${m.repo_id}`}
      onSaved={reloadModels}
      display={display}
    />
  );
};

/** Metric chips for a model row — family / pipeline / GGUF / size / VRAM / GPU-fit. */
const renderModelBadges = (
  m: ModelCatalogEntry & CatalogRuntime,
  t: ReturnType<typeof useTranslations>,
) => {
  const fitMeta = m.fit ? fitChipMeta(m.fit.verdict) : null;
  return (
    <>
      <Chip label={m.family} size="small" color="primary" variant="outlined" />
      <Chip label={m.pipeline_tag} size="small" variant="outlined" />
      {m.gguf_filename && (
        <Tooltip title={t("models.quantizedHint")}>
          <Chip label={t("models.quantized")} size="small" variant="outlined" />
        </Tooltip>
      )}
      <Chip
        icon={<StorageIcon />}
        label={`${t("models.size")} ≈ ${m.approx_size_gb} GB`}
        size="small"
        variant="outlined"
      />
      <Chip
        icon={<MemoryIcon />}
        label={`${t("models.vram")} ≥ ${m.min_vram_gb} GB`}
        size="small"
        variant="outlined"
      />
      {fitMeta && m.fit && (
        <Tooltip
          title={t(fitMeta.tooltipKey, {
            vram: m.fit.est_vram_gb,
            total: m.fit.gpu_total_gb ?? "?",
          })}
        >
          <Chip label={t(fitMeta.labelKey)} size="small" color={fitMeta.color} variant="outlined" />
        </Tooltip>
      )}
    </>
  );
};
