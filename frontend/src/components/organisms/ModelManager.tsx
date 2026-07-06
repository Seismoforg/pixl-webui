"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useMemo, useState } from "react";

import { useDownloads } from "@/providers/DownloadProvider";
import { MonoText } from "@/components/atoms/MonoText";
import { SectionHeading } from "@/components/atoms/SectionHeading";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { ModelListItem } from "@/components/molecules/ModelListItem";
import { SkeletonList } from "@/components/molecules/SkeletonList";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { fitBucket, fitRank } from "@/lib/fit";
import type { DownloadProgress, ModelEntry } from "@/types";

interface ModelManagerProps {
  models: ModelEntry[];
  // True while the initial models load is in flight (shows the skeleton list).
  loading: boolean;
  onChanged: () => void;
}

const errorProgress = (slug: string, err: unknown): DownloadProgress => {
  return {
    slug,
    status: "error",
    downloaded_bytes: 0,
    total_bytes: 0,
    percent: 0,
    error: err instanceof Error ? err.message : String(err),
  };
}

export const ModelManager = ({ models, loading, onChanged }: ModelManagerProps) => {
  const t = useTranslations();
  // Downloads are tracked app-level (survive navigation + feed the off-route
  // bubble); local `errors` only holds POST/delete failures for inline display.
  const downloads = useDownloads();
  const [errors, setErrors] = useState<Record<string, DownloadProgress>>({});
  const progressFor = (slug: string) => errors[slug] ?? downloads.progress[slug];
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  const [pipelineFilter, setPipelineFilter] = useState("");

  const familyOptions = useMemo(
    () => Array.from(new Set(models.map((m) => m.family))).sort(),
    [models],
  );
  const pipelineOptions = useMemo(
    () => Array.from(new Set(models.map((m) => m.pipeline_tag))).sort(),
    [models],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(
      (m) =>
        (familyFilter === "" || m.family === familyFilter) &&
        (pipelineFilter === "" || m.pipeline_tag === pipelineFilter) &&
        (q === "" ||
          m.name.toLowerCase().includes(q) ||
          m.repo_id.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q)),
    );
  }, [models, query, familyFilter, pipelineFilter]);

  const installed = useMemo(() => filtered.filter((m) => m.downloaded), [filtered]);
  // Not-yet-downloaded models, split into fit buckets (best fit first) so oversized
  // ones sink into their own labelled sections.
  const byBucket = useMemo(() => {
    const rest = filtered
      .filter((m) => !m.downloaded)
      .sort((a, b) => fitRank[a.fit.verdict] - fitRank[b.fit.verdict]);
    return {
      available: rest.filter((m) => fitBucket(m.fit.verdict) === "available"),
      offload: rest.filter((m) => fitBucket(m.fit.verdict) === "offload"),
      tooLarge: rest.filter((m) => fitBucket(m.fit.verdict) === "tooLarge"),
    };
  }, [filtered]);

  const handleDelete = async (slug: string) => {
    setPendingSlug(null);
    try {
      await api.deleteModel(slug);
      onChanged();
    } catch (err) {
      setErrors((prev) => ({ ...prev, [slug]: errorProgress(slug, err) }));
    }
  };

  const handleDownload = async (slug: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
    const model = models.find((m) => m.slug === slug);
    try {
      await api.downloadModel(slug);
      downloads.track(slug, {
        title: model?.name ?? slug,
        route: "/models",
        kind: "model",
        fetch: () => api.getProgress(slug),
        retry: () => api.downloadModel(slug),
      });
    } catch (err) {
      setErrors((prev) => ({ ...prev, [slug]: errorProgress(slug, err) }));
    }
  };

  const section = (titleKey: string, entries: ModelEntry[]) => {
    if (entries.length === 0) return null;
    return (
      <Box key={titleKey}>
        <SectionHeading
          level={3}
          variant="subtitle2"
          sx={{ mb: 1.5, color: "text.secondary" }}
        >
          {t(titleKey)} (<MonoText>{entries.length}</MonoText>)
        </SectionHeading>
        <Stack spacing={1.5}>
          {entries.map((model) => (
            <ModelListItem
              key={model.slug}
              model={model}
              progress={progressFor(model.slug)}
              onDownload={handleDownload}
              onDelete={setPendingSlug}
            />
          ))}
        </Stack>
      </Box>
    );
  };

  return (
    <Box>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("models.title")}
      </SectionHeading>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          label={t("models.searchLabel")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flexGrow: 1 }}
        />
        <TextField
          select
          label={t("models.filterFamily")}
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">{t("models.allFamilies")}</MenuItem>
          {familyOptions.map((f) => (
            <MenuItem key={f} value={f}>
              {f}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t("models.filterPipeline")}
          value={pipelineFilter}
          onChange={(e) => setPipelineFilter(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">{t("models.allPipelines")}</MenuItem>
          {pipelineOptions.map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {loading && models.length === 0 ? (
        <SkeletonList count={5} />
      ) : filtered.length === 0 ? (
        <Alert severity="info">{t("models.noResults")}</Alert>
      ) : (
        <Stack spacing={3}>
          {section("models.installed", installed)}
          {section("models.available", byBucket.available)}
          {section("models.availableOffload", byBucket.offload)}
          {section("models.availableTooLarge", byBucket.tooLarge)}
        </Stack>
      )}

      <ConfirmDialog
        open={pendingSlug !== null}
        title={t("common.confirmDeleteTitle")}
        message={t("models.confirmDelete")}
        confirmLabel={t("models.delete")}
        onConfirm={() => pendingSlug && handleDelete(pendingSlug)}
        onClose={() => setPendingSlug(null)}
      />
    </Box>
  );
}
