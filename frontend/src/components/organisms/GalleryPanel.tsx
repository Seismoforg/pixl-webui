"use client";

import DeleteIcon from "@mui/icons-material/Delete";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ReplayIcon from "@mui/icons-material/Replay";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";

import { MonoText } from "@/components/atoms/MonoText";
import { SectionHeading } from "@/components/atoms/SectionHeading";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { GalleryCard } from "@/components/molecules/GalleryCard";
import { SkeletonCardGrid } from "@/components/molecules/SkeletonCardGrid";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useAsyncData } from "@/lib/useAsyncData";
import type { GalleryImage, Sampler } from "@/types";

interface GalleryPanelProps {
  onRegenerate: (image: GalleryImage) => void;
  onUpscale: (image: GalleryImage) => void;
  // Changes whenever the gallery should refetch (navigation / finished generation).
  reloadToken: number;
}

export const GalleryPanel = ({ onRegenerate, onUpscale, reloadToken }: GalleryPanelProps) => {
  const t = useTranslations();

  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useAsyncData(() => api.getImages(), [reloadToken]);
  // Stable ref when `data` is null so the memos below don't recompute every render.
  const images = useMemo(() => data ?? [], [data]);
  const [query, setQuery] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [selected, setSelected] = useState<GalleryImage | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [samplers, setSamplers] = useState<Sampler[]>([]);

  useEffect(() => {
    api
      .getSamplers()
      .then((l) => setSamplers(l.samplers))
      .catch(() => setSamplers([]));
  }, []);

  const samplerLabel = useMemo(() => {
    const map = new Map(samplers.map((s) => [s.id, s.label]));
    return (id: string) => map.get(id) ?? id;
  }, [samplers]);

  const modelOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const img of images) map.set(img.model_slug, img.model_name);
    return Array.from(map, ([slug, name]) => ({ slug, name }));
  }, [images]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return images.filter(
      (img) =>
        (modelFilter === "" || img.model_slug === modelFilter) &&
        (q === "" || img.prompt.toLowerCase().includes(q)),
    );
  }, [images, query, modelFilter]);

  // Drop any selected ids that fell out of the current filter so a hidden image
  // can never be swept up by a bulk delete.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(filtered.map((img) => img.id));
      const next = new Set([...prev].filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const toggleSelect = (image: GalleryImage) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(image.id)) next.delete(image.id);
      else next.add(image.id);
      return next;
    });

  const selectAll = () => setSelectedIds(new Set(filtered.map((img) => img.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleDelete = async (id: string) => {
    setPendingId(null);
    try {
      await api.deleteImage(id);
      reload();
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBulkDelete = async () => {
    setBulkPending(false);
    try {
      await api.deleteImages([...selectedIds]);
      clearSelection();
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRegenerate = (image: GalleryImage) => {
    setSelected(null);
    onRegenerate(image);
  };

  return (
    <Box>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("gallery.title")}
      </SectionHeading>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          label={t("gallery.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          size="small"
          sx={{ flexGrow: 1 }}
        />
        <TextField
          select
          label={t("gallery.filterModel")}
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          size="small"
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{t("gallery.allModels")}</MenuItem>
          {modelOptions.map((m) => (
            <MenuItem key={m.slug} value={m.slug}>
              {m.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {selectedIds.size > 0 && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ mb: 2, alignItems: "center", flexWrap: "wrap" }}
        >
          <Typography variant="body2" sx={{ mr: "auto" }}>
            {t("gallery.selectedCount", { count: selectedIds.size })}
          </Typography>
          <Button size="small" onClick={selectAll} disabled={selectedIds.size === filtered.length}>
            {t("gallery.selectAll")}
          </Button>
          <Button size="small" onClick={clearSelection}>
            {t("gallery.clearSelection")}
          </Button>
          <Button
            size="small"
            color="error"
            variant="contained"
            startIcon={<DeleteIcon />}
            onClick={() => setBulkPending(true)}
          >
            {t("gallery.deleteSelected")}
          </Button>
        </Stack>
      )}

      {loadError && images.length === 0 ? (
        <Alert severity="error">{t("gallery.loadError")}</Alert>
      ) : loading && images.length === 0 ? (
        <SkeletonCardGrid count={8} lines={2} />
      ) : images.length === 0 ? (
        <Alert severity="info">{t("gallery.empty")}</Alert>
      ) : filtered.length === 0 ? (
        <Alert severity="info">{t("gallery.noResults")}</Alert>
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
        >
          {filtered.map((img) => (
            <GalleryCard
              key={img.id}
              image={img}
              onOpen={setSelected}
              onRegenerate={handleRegenerate}
              onUpscale={onUpscale}
              onDelete={(image) => setPendingId(image.id)}
              selected={selectedIds.has(img.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </Box>
      )}

      <Dialog open={selected !== null} onClose={() => setSelected(null)} maxWidth="md" fullWidth>
        {selected && (
          <>
            <DialogTitle>{t("gallery.details")}</DialogTitle>
            <DialogContent dividers>
              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  alignItems: "start",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <Box
                  component="img"
                  src={api.imageFileUrl(selected.id)}
                  alt={selected.prompt}
                  sx={{
                    width: "100%",
                    aspectRatio: `${selected.width} / ${selected.height}`,
                    borderRadius: 1,
                  }}
                />
                <Stack spacing={1}>
                  <DetailRow label={t("gallery.prompt")} value={selected.prompt} />
                  {selected.negative_prompt && (
                    <DetailRow
                      label={t("gallery.negativePrompt")}
                      value={selected.negative_prompt}
                    />
                  )}
                  <DetailRow label={t("gallery.model")} value={selected.model_name} />
                  <DetailRow label={t("gallery.seed")} value={String(selected.seed)} mono />
                  <DetailRow label={t("gallery.steps")} value={String(selected.steps)} mono />
                  <DetailRow
                    label={t("gallery.guidance")}
                    value={String(selected.guidance_scale)}
                    mono
                  />
                  <DetailRow label={t("gallery.sampler")} value={samplerLabel(selected.sampler)} />
                  <DetailRow
                    label={t("gallery.size")}
                    value={`${selected.width}×${selected.height}`}
                    mono
                  />
                  {selected.loras && selected.loras.length > 0 && (
                    <DetailRow label={t("gallery.loras")} value={selected.loras.join(", ")} />
                  )}
                  <DetailRow label={t("gallery.created")} value={selected.created} />
                </Stack>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => setPendingId(selected.id)}
              >
                {t("gallery.delete")}
              </Button>
              <Box sx={{ flexGrow: 1 }} />
              <Button
                component="a"
                href={api.imageFileUrl(selected.id)}
                target="_blank"
                rel="noopener"
                startIcon={<OpenInNewIcon />}
              >
                {t("gallery.openFull")}
              </Button>
              <Button onClick={() => setSelected(null)}>{t("gallery.close")}</Button>
              <Button
                variant="contained"
                startIcon={<ReplayIcon />}
                onClick={() => handleRegenerate(selected)}
              >
                {t("gallery.regenerate")}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={pendingId !== null}
        title={t("common.confirmDeleteTitle")}
        message={t("gallery.confirmDelete")}
        confirmLabel={t("gallery.delete")}
        onConfirm={() => pendingId && handleDelete(pendingId)}
        onClose={() => setPendingId(null)}
      />

      <ConfirmDialog
        open={bulkPending}
        title={t("common.confirmDeleteTitle")}
        message={t("gallery.confirmBulkDelete", { count: selectedIds.size })}
        confirmLabel={t("gallery.deleteSelected")}
        onConfirm={handleBulkDelete}
        onClose={() => setBulkPending(false)}
      />
    </Box>
  );
};

const DetailRow = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
        {mono ? <MonoText>{value}</MonoText> : value}
      </Typography>
    </Box>
  );
};
