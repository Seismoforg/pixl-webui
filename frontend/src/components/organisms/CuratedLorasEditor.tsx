"use client";

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
import { trackLoraDownload, useDownloads } from "@/providers/DownloadProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { LoraCatalogEntry } from "@/types";

// The LoRA category values offered in the editor + badge (mirrors backend LoraInfo.kind).
const LORA_KINDS = ["style", "character", "concept", "realism", "accelerator", "other"] as const;

const EMPTY: LoraCatalogEntry = {
  slug: "",
  repo_id: "",
  filename: "",
  name: "",
  family: "SDXL",
  kind: "other",
  description: "",
  trigger: null,
  approx_size_gb: 0,
};

/** Settings section to edit the curated LoRA catalog (JSON-backed). */
export const CuratedLorasEditor = () => {
  const t = useTranslations();
  const downloads = useDownloads();

  const fields = useMemo<FieldSpec[]>(() => {
    const f = (key: string) => t(`settings.catalog.fields.${key}`);
    return [
      { key: "slug", label: f("slug"), type: "text" },
      { key: "name", label: f("name"), type: "text" },
      {
        key: "family",
        label: f("family"),
        type: "select",
        options: [
          { value: "SD 1.5", label: "SD 1.5" },
          { value: "SDXL", label: "SDXL" },
          { value: "FLUX", label: "FLUX" },
        ],
      },
      {
        key: "kind",
        label: t("lora.kindLabel"),
        type: "select",
        options: LORA_KINDS.map((k) => ({ value: k, label: t(`lora.kind.${k}`) })),
      },
      { key: "repo_id", label: f("repoId"), type: "text" },
      { key: "filename", label: f("filename"), type: "text" },
      { key: "description", label: f("description"), type: "multiline" },
      { key: "trigger", label: f("trigger"), type: "text", nullable: true },
      { key: "approx_size_gb", label: f("sizeGb"), type: "number", min: 0, step: 0.01 },
    ];
  }, [t]);

  const display: CatalogDisplay<LoraCatalogEntry> = {
    loadRuntime: api.getLoras,
    groupBy: (l) => l.family,
    // LoRAs carry no GPU-fit verdict: installed first, then by name.
    sortWithin: (a, b) =>
      Number(b.downloaded) - Number(a.downloaded) || a.name.localeCompare(b.name),
    renderBadges: (l) => renderLoraBadges(l, t),
    onDownload: (l) => trackLoraDownload(downloads.track, l, "/settings"),
    onDeleteDownload: (slug) => api.deleteLora(slug).then(() => undefined),
  };

  return (
    <CatalogEditor<LoraCatalogEntry>
      title={t("settings.lorasCatalog.title")}
      description={t("settings.lorasCatalog.description")}
      fields={fields}
      load={api.getLorasCatalog}
      save={api.saveLorasCatalog}
      reset={api.resetLorasCatalog}
      emptyEntry={EMPTY}
      primaryText={(e) => `${e.name || e.slug}`}
      secondaryText={(e) => `${e.family} · ${e.repo_id}`}
      display={display}
    />
  );
};

/** Metric chips for a LoRA row — family / type / download size. */
const renderLoraBadges = (
  l: LoraCatalogEntry & CatalogRuntime,
  t: ReturnType<typeof useTranslations>,
) => (
  <>
    <Chip label={l.family} size="small" color="primary" variant="outlined" />
    <Tooltip title={t("lora.kindLabel")}>
      <Chip label={t(`lora.kind.${l.kind}`)} size="small" variant="outlined" />
    </Tooltip>
    <Chip
      icon={<StorageIcon />}
      label={`${t("models.size")} ≈ ${l.approx_size_gb} GB`}
      size="small"
      variant="outlined"
    />
  </>
);
