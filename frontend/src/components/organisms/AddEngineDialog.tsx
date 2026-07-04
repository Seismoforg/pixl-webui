"use client";

import SearchIcon from "@mui/icons-material/Search";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";

import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { EngineResolve, UpscalerKind } from "@/types";

interface AddEngineDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

const KINDS: UpscalerKind[] = ["realesrgan", "sd_x4", "inpaint"];

export const AddEngineDialog = ({ open, onClose, onAdded }: AddEngineDialogProps) => {
  const t = useTranslations();

  const [repoId, setRepoId] = useState("");
  const [kind, setKind] = useState<UpscalerKind>("realesrgan");
  const [filename, setFilename] = useState("");
  const [resolved, setResolved] = useState<EngineResolve | null>(null);
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setResolved(null);
    setFilename("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    setRepoId("");
    setKind("realesrgan");
    onClose();
  };

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoId.trim()) return;
    setResolving(true);
    reset();
    try {
      const r = await api.resolveUpscaler(repoId.trim(), kind);
      setResolved(r);
      if (r.weights.length > 0) setFilename(r.weights[0].filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  };

  const handleAdd = async () => {
    if (!resolved) return;
    setAdding(true);
    setError(null);
    try {
      await api.addUpscaler(resolved.repo_id, kind, kind === "realesrgan" ? filename : null);
      onAdded();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const needsFile = kind === "realesrgan";
  const canAdd =
    !!resolved && resolved.compatible && (!needsFile || !!filename) && !adding;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("engines.browser.title")}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box
            component="form"
            onSubmit={handleResolve}
            sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 1.5 }}
          >
            <TextField
              label={t("engines.browser.repoId")}
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
              helperText={t("engines.browser.repoIdHint")}
              size="small"
              sx={{ flexGrow: 1, minWidth: { xs: "100%", sm: 240 } }}
            />
            <TextField
              select
              label={t("engines.browser.kind")}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as UpscalerKind);
                reset();
              }}
              size="small"
              sx={{ minWidth: { xs: "100%", sm: 180 } }}
            >
              {KINDS.map((k) => (
                <MenuItem key={k} value={k}>
                  {t(`engines.kind.${k}`)}
                </MenuItem>
              ))}
            </TextField>
            <Button
              type="submit"
              variant="contained"
              startIcon={resolving ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
              disabled={resolving || !repoId.trim()}
              sx={{ flexShrink: 0, height: 40 }}
            >
              {t("engines.browser.resolve")}
            </Button>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          {resolved && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                  <Chip label={t(`engines.kind.${resolved.kind}`)} size="small" color="primary" variant="outlined" />
                  {!needsFile && (
                    <Chip
                      label={`${t("models.size")} ≈ ${resolved.approx_size_gb} GB`}
                      size="small"
                      variant="outlined"
                    />
                  )}
                </Box>
                {!resolved.compatible && (
                  <Alert severity="warning">{t("engines.browser.incompatible")}</Alert>
                )}
                {needsFile && resolved.compatible && (
                  <TextField
                    select
                    label={t("engines.browser.weightFile")}
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    size="small"
                    fullWidth
                  >
                    {resolved.weights.map((w) => (
                      <MenuItem key={w.filename} value={w.filename}>
                        {w.filename} (≈ {w.approx_size_gb} GB)
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              </Stack>
            </Paper>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t("engines.browser.close")}</Button>
        <Button variant="contained" onClick={handleAdd} disabled={!canAdd}>
          {t("engines.browser.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
