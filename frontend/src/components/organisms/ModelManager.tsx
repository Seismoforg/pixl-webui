"use client";

import AddIcon from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useEffect, useMemo, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { ModelCard } from "@/components/molecules/ModelCard";
import { AddModelDialog } from "@/components/organisms/AddModelDialog";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { DownloadProgress, ModelEntry } from "@/types";

interface ModelManagerProps {
  models: ModelEntry[];
  onChanged: () => void;
}

const POLL_MS = 1500;

export function ModelManager({ models, onChanged }: ModelManagerProps) {
  const t = useTranslations();
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const curated = useMemo(() => models.filter((m) => m.curated), [models]);
  const added = useMemo(() => models.filter((m) => !m.curated), [models]);

  const activeSlugs = useMemo(
    () =>
      models
        .filter((m) => (progress[m.slug]?.status ?? m.status) === "downloading")
        .map((m) => m.slug),
    [models, progress],
  );

  useEffect(() => {
    if (activeSlugs.length === 0) return undefined;

    const id = setInterval(async () => {
      const updates = await Promise.all(activeSlugs.map((s) => api.getProgress(s)));
      let finished = false;
      setProgress((prev) => {
        const next = { ...prev };
        for (const update of updates) {
          next[update.slug] = update;
          if (update.status === "done" || update.status === "error") finished = true;
        }
        return next;
      });
      if (finished) onChanged();
    }, POLL_MS);

    return () => clearInterval(id);
    // activeSlugs is derived; join to keep the dependency stable
  }, [activeSlugs.join(","), onChanged]);

  const handleDelete = async (slug: string) => {
    setPendingSlug(null);
    try {
      await api.deleteModel(slug);
      onChanged();
    } catch (err) {
      setProgress((prev) => ({
        ...prev,
        [slug]: {
          slug,
          status: "error",
          downloaded_bytes: 0,
          total_bytes: 0,
          percent: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const handleDownload = async (slug: string) => {
    setProgress((prev) => ({
      ...prev,
      [slug]: {
        slug,
        status: "downloading",
        downloaded_bytes: 0,
        total_bytes: 0,
        percent: 0,
        error: null,
      },
    }));
    try {
      await api.downloadModel(slug);
    } catch (err) {
      setProgress((prev) => ({
        ...prev,
        [slug]: {
          slug,
          status: "error",
          downloaded_bytes: 0,
          total_bytes: 0,
          percent: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const grid = (entries: ModelEntry[]) => (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      }}
    >
      {entries.map((model) => (
        <ModelCard
          key={model.slug}
          model={model}
          progress={progress[model.slug]}
          onDownload={handleDownload}
          onDelete={setPendingSlug}
        />
      ))}
    </Box>
  );

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <SectionHeading level={2}>{t("models.title")}</SectionHeading>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
        >
          {t("models.browser.add")}
        </Button>
      </Stack>

      {grid(curated)}

      {added.length > 0 && (
        <>
          <SectionHeading
            level={3}
            variant="subtitle2"
            sx={{ mt: 3, mb: 1.5, color: "text.secondary" }}
          >
            {t("models.added")}
          </SectionHeading>
          {grid(added)}
        </>
      )}

      <AddModelDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={onChanged}
      />

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
