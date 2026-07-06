"use client";

import { useMemo } from "react";

import { CatalogEditor, type FieldSpec } from "@/components/organisms/CatalogEditor";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { LoraCatalogEntry } from "@/types";

const EMPTY: LoraCatalogEntry = {
  slug: "",
  repo_id: "",
  filename: "",
  name: "",
  family: "SDXL",
  description: "",
  trigger: null,
  approx_size_gb: 0,
};

/** Settings section to edit the curated LoRA catalog (JSON-backed). */
export const CuratedLorasEditor = () => {
  const t = useTranslations();

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
      { key: "repo_id", label: f("repoId"), type: "text" },
      { key: "filename", label: f("filename"), type: "text" },
      { key: "description", label: f("description"), type: "multiline" },
      { key: "trigger", label: f("trigger"), type: "text", nullable: true },
      { key: "approx_size_gb", label: f("sizeGb"), type: "number", min: 0, step: 0.01 },
    ];
  }, [t]);

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
    />
  );
};
