"use client";

import BookmarkAddIcon from "@mui/icons-material/BookmarkAdd";
import DeleteIcon from "@mui/icons-material/Delete";
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
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { PromptKind, PromptSnippet } from "@/types";

interface PromptSnippetsProps {
  kind: PromptKind;
  snippets: PromptSnippet[];
  currentText: string;
  onApply: (text: string) => void;
  onChanged: () => void;
}

/**
 * Compact snippet control shown next to a prompt field: a menu to apply
 * (append) a saved snippet, and a dialog to save the field's current text as a
 * new snippet and delete existing ones. Rendered once per kind (positive /
 * negative) with its own filtered list.
 */
export const PromptSnippets = ({
  kind,
  snippets,
  currentText,
  onApply,
  onChanged,
}: PromptSnippetsProps) => {
  const t = useTranslations();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const loadLabel = {
    positive: t("generate.snippets.loadPositive"),
    negative: t("generate.snippets.loadNegative"),
    upscale: t("generate.snippets.loadUpscale"),
  }[kind];
  const manageTitle = {
    positive: t("generate.snippets.manageTitlePositive"),
    negative: t("generate.snippets.manageTitleNegative"),
    upscale: t("generate.snippets.manageTitleUpscale"),
  }[kind];

  const apply = (text: string) => {
    onApply(text);
    setAnchorEl(null);
  };

  const save = async () => {
    if (name.trim() === "" || currentText.trim() === "") return;
    setBusy(true);
    try {
      await api.createPromptSnippet(kind, name.trim(), currentText.trim());
      setName("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await api.deletePromptSnippet(id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Button size="small" onClick={(e) => setAnchorEl(e.currentTarget)}>
          {loadLabel}
        </Button>
        <Tooltip title={t("generate.snippets.save")}>
          <span>
            <IconButton
              size="small"
              onClick={() => setDialogOpen(true)}
              disabled={currentText.trim() === ""}
              aria-label={t("generate.snippets.save")}
            >
              <BookmarkAddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Menu anchorEl={anchorEl} open={anchorEl !== null} onClose={() => setAnchorEl(null)}>
        {snippets.length === 0 ? (
          <MenuItem disabled>{t("generate.snippets.empty")}</MenuItem>
        ) : (
          snippets.map((s) => (
            <MenuItem key={s.id} onClick={() => apply(s.text)}>
              {s.name}
            </MenuItem>
          ))
        )}
      </Menu>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{manageTitle}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {t("generate.snippets.saveHint")}
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  label={t("generate.snippets.name")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  size="small"
                  sx={{ flexGrow: 1 }}
                />
                <Button
                  variant="contained"
                  onClick={save}
                  disabled={busy || name.trim() === "" || currentText.trim() === ""}
                >
                  {t("generate.snippets.save")}
                </Button>
              </Stack>
            </Box>

            {snippets.length > 0 && (
              <>
                <Divider />
                <List dense sx={{ maxHeight: 240, overflow: "auto" }}>
                  {snippets.map((s) => (
                    <ListItem
                      key={s.id}
                      secondaryAction={
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={() => remove(s.id)}
                          disabled={busy}
                          aria-label={t("generate.snippets.delete")}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
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
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t("generate.snippets.close")}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
