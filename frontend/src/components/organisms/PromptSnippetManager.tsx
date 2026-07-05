"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { PromptKind, PromptSnippet } from "@/types";

type EditTarget = { mode: "add" | "edit"; kind: PromptKind; id?: string };

/**
 * Settings-page manager for prompt snippets: lists positive/negative snippets and
 * supports add (POST), edit (PUT) and delete (DELETE) via the existing
 * /api/prompt-templates endpoints.
 */
export const PromptSnippetManager = () => {
  const t = useTranslations();
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const reload = useCallback(() => {
    api.getPromptSnippets().then(setSnippets).catch(() => setSnippets([]));
  }, []);
  useEffect(() => reload(), [reload]);

  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PromptSnippet | null>(null);

  const openAdd = (kind: PromptKind) => {
    setEditing({ mode: "add", kind });
    setName("");
    setText("");
  };
  const openEdit = (s: PromptSnippet) => {
    setEditing({ mode: "edit", kind: s.kind, id: s.id });
    setName(s.name);
    setText(s.text);
  };

  const submit = async () => {
    if (editing === null || name.trim() === "" || text.trim() === "") return;
    setBusy(true);
    setError(false);
    try {
      if (editing.mode === "add") {
        await api.createPromptSnippet(editing.kind, name.trim(), text.trim());
      } else {
        await api.updatePromptSnippet(editing.id!, name.trim(), text.trim());
      }
      reload();
      setEditing(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (pendingDelete === null) return;
    setBusy(true);
    setError(false);
    try {
      await api.deletePromptSnippet(pendingDelete.id);
      reload();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  const kindTitle: Record<PromptKind, string> = {
    positive: t("settings.snippets.positive"),
    negative: t("settings.snippets.negative"),
    upscale: t("settings.snippets.upscale"),
    outpaint: t("settings.snippets.outpaint"),
    outpaint_negative: t("settings.snippets.outpaintNegative"),
  };

  const renderList = (kind: PromptKind, items: PromptSnippet[]) => (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <SectionHeading level={3} variant="subtitle2">
          {kindTitle[kind]}
        </SectionHeading>
        <Button size="small" startIcon={<AddIcon />} onClick={() => openAdd(kind)}>
          {t("settings.snippets.add")}
        </Button>
      </Stack>
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("settings.snippets.empty")}
        </Typography>
      ) : (
        <List dense disablePadding>
          {items.map((s) => (
            <ListItem
              key={s.id}
              disableGutters
              secondaryAction={
                <>
                  <IconButton
                    size="small"
                    onClick={() => openEdit(s)}
                    aria-label={t("settings.snippets.edit")}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setPendingDelete(s)}
                    aria-label={t("settings.snippets.delete")}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </>
              }
            >
              <ListItemText
                primary={s.name}
                secondary={s.text}
                secondaryTypographyProps={{ noWrap: true }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 560 }}>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("settings.snippets.title")}
      </SectionHeading>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("common.error")}
        </Alert>
      )}
      <Stack spacing={3}>
        {renderList("positive", snippets.filter((s) => s.kind === "positive"))}
        <Divider />
        {renderList("negative", snippets.filter((s) => s.kind === "negative"))}
        <Divider />
        {renderList("upscale", snippets.filter((s) => s.kind === "upscale"))}
        <Divider />
        {renderList("outpaint", snippets.filter((s) => s.kind === "outpaint"))}
        <Divider />
        {renderList("outpaint_negative", snippets.filter((s) => s.kind === "outpaint_negative"))}
      </Stack>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editing?.mode === "add"
            ? t("settings.snippets.addTitle")
            : t("settings.snippets.editTitle")}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t("settings.snippets.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label={t("settings.snippets.text")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <Button
            variant="contained"
            onClick={submit}
            disabled={busy || name.trim() === "" || text.trim() === ""}
          >
            {t("settings.snippets.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("common.confirmDeleteTitle")}
        message={t("settings.snippets.confirmDelete")}
        confirmLabel={t("settings.snippets.delete")}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Paper>
  );
}
