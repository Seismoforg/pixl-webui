"use client";

import { useMemo } from "react";

import { CatalogEditor, type FieldSpec } from "@/components/organisms/CatalogEditor";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
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
    />
  );
};
