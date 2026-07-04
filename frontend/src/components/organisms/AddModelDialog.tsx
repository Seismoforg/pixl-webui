"use client";

import SearchIcon from "@mui/icons-material/Search";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { fitChipMeta } from "@/lib/fit";
import type { HfSearchResult, ResolvedModel } from "@/types";

interface AddModelDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

// Families the browser can filter by (match the backend's detected families).
const FAMILIES = ["SD 1.5", "SDXL", "FLUX", "SD 3.x"];

// HuggingFace pipeline tags selectable in the search (default: text-to-image).
const PIPELINES = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
  "unconditional-image-generation",
];

export const AddModelDialog = ({ open, onClose, onAdded }: AddModelDialogProps) => {
  const t = useTranslations();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("downloads");
  const [family, setFamily] = useState("");
  const [pipelines, setPipelines] = useState<string[]>(["text-to-image"]);
  const [results, setResults] = useState<HfSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedModel | null>(null);
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setResults([]);
    setSelected(null);
    setResolved(null);
    setError(null);
  };

  const handleClose = () => {
    reset();
    setQuery("");
    setFamily("");
    setPipelines(["text-to-image"]);
    onClose();
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setError(null);
    setSelected(null);
    setResolved(null);
    try {
      setResults(
        await api.searchModels(
          query,
          sort,
          family,
          pipelines.length > 0 ? pipelines : ["text-to-image"],
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = async (repoId: string) => {
    setSelected(repoId);
    setResolved(null);
    setResolving(true);
    setError(null);
    try {
      setResolved(await api.resolveModel(repoId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  };

  const handleDownload = async () => {
    if (!resolved) return;
    setAdding(true);
    setError(null);
    try {
      await api.addModel(resolved.repo_id);
      onAdded();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { m: { xs: 1, sm: 4 }, maxHeight: { xs: "calc(100% - 16px)", sm: "calc(100% - 64px)" } } }}
    >
      <DialogTitle>{t("models.browser.title")}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box
            component="form"
            onSubmit={handleSearch}
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-start",
              gap: 1.5,
            }}
          >
            <TextField
              label={t("models.browser.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              helperText={t("models.browser.searchHint")}
              size="small"
              sx={{ flexGrow: 1, minWidth: { xs: "100%", sm: 220 } }}
            />
            <TextField
              select
              label={t("models.browser.family")}
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              size="small"
              sx={{ minWidth: { xs: "100%", sm: 150 } }}
            >
              <MenuItem value="">{t("models.browser.familyAll")}</MenuItem>
              {FAMILIES.map((f) => (
                <MenuItem key={f} value={f}>
                  {f}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t("models.browser.pipeline")}
              value={pipelines}
              onChange={(e) => {
                const v = e.target.value;
                setPipelines(typeof v === "string" ? v.split(",") : (v as string[]));
              }}
              size="small"
              sx={{ minWidth: { xs: "100%", sm: 200 } }}
              SelectProps={{
                multiple: true,
                renderValue: (sel) => (sel as string[]).join(", "),
              }}
            >
              {PIPELINES.map((p) => (
                <MenuItem key={p} value={p}>
                  <Checkbox checked={pipelines.indexOf(p) > -1} size="small" />
                  <ListItemText primary={p} />
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t("models.browser.sort")}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              size="small"
              sx={{ minWidth: { xs: "100%", sm: 150 } }}
            >
              <MenuItem value="downloads">{t("models.browser.sortDownloads")}</MenuItem>
              <MenuItem value="likes">{t("models.browser.sortLikes")}</MenuItem>
              <MenuItem value="trending">{t("models.browser.sortTrending")}</MenuItem>
            </TextField>
            <Button
              type="submit"
              variant="contained"
              startIcon={searching ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
              disabled={searching}
              sx={{ flexShrink: 0, whiteSpace: "nowrap", height: 40 }}
            >
              {t("models.browser.search")}
            </Button>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          {results.length > 0 && (
            <List dense sx={{ maxHeight: 260, overflow: "auto" }}>
              {results.map((r) => (
                <ListItemButton
                  key={r.repo_id}
                  selected={selected === r.repo_id}
                  onClick={() => handleSelect(r.repo_id)}
                  sx={{ gap: 1 }}
                >
                  <ListItemText
                    primary={r.repo_id}
                    secondary={`${t("models.browser.downloads")}: ${r.downloads.toLocaleString()} · ${t("models.browser.likes")}: ${r.likes.toLocaleString()}`}
                  />
                  {r.pipeline_tag && (
                    <Chip
                      label={r.pipeline_tag}
                      size="small"
                      color="secondary"
                      variant="outlined"
                      sx={{ flexShrink: 0 }}
                    />
                  )}
                  <Chip label={r.family} size="small" variant="outlined" sx={{ flexShrink: 0 }} />
                </ListItemButton>
              ))}
            </List>
          )}

          {!searching && results.length === 0 && !error && selected === null && (
            <Typography variant="body2" color="text.secondary">
              {t("models.browser.searchHint")}
            </Typography>
          )}

          {resolving && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2">{t("models.browser.resolving")}</Typography>
            </Stack>
          )}

          {resolved && <ResolvedDetails resolved={resolved} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t("models.browser.close")}</Button>
        <Button
          variant="contained"
          onClick={handleDownload}
          disabled={!resolved || !resolved.compatible || adding}
        >
          {t("models.browser.download")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const ResolvedDetails = ({ resolved }: { resolved: ResolvedModel }) => {
  const t = useTranslations();
  const fitMeta = fitChipMeta(resolved.fit.verdict);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight="medium">
          {resolved.name}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Chip label={resolved.family} size="small" color="primary" variant="outlined" />
          <Chip
            label={resolved.pipeline_tag}
            size="small"
            color="secondary"
            variant="outlined"
          />
          <Chip
            label={`${t("models.browser.size")} ≈ ${resolved.approx_size_gb} GB`}
            size="small"
            variant="outlined"
          />
          <Chip
            label={`${t("models.browser.vram")} ≈ ${resolved.min_vram_gb} GB (${t("models.estimated")})`}
            size="small"
            variant="outlined"
          />
          <Chip
            label={t(fitMeta.labelKey)}
            size="small"
            color={fitMeta.color}
            variant="outlined"
          />
        </Box>
        {!resolved.compatible && (
          <Alert severity="warning">{t("models.browser.incompatible")}</Alert>
        )}
      </Stack>
    </Paper>
  );
}
