"use client";

import { useMemo } from "react";

import { CatalogEditor, type FieldSpec } from "@/components/organisms/CatalogEditor";
import { useAppData } from "@/providers/AppDataProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
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

  const fields = useMemo<FieldSpec[]>(() => {
    const f = (key: string) => t(`settings.catalog.fields.${key}`);
    return [
      { key: "slug", label: f("slug"), type: "text" },
      { key: "name", label: f("name"), type: "text" },
      { key: "repo_id", label: f("repoId"), type: "text" },
      { key: "family", label: f("family"), type: "text" },
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
    />
  );
};
