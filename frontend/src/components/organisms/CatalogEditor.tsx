"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { useTranslations } from "@/i18n";

export type FieldType = "text" | "multiline" | "number" | "boolean" | "select";

export interface FieldSpec {
  key: string; // dotted path into the entry, e.g. "defaults.steps"
  label: string; // already-translated label
  type: FieldType;
  options?: { value: string; label: string }[]; // for "select"
  nullable?: boolean; // "text"/"select": empty input persists as null
  min?: number;
  max?: number;
  step?: number;
}

interface CatalogEditorProps<T> {
  title: string;
  description: string;
  fields: FieldSpec[];
  load: () => Promise<T[]>;
  save: (entries: T[]) => Promise<T[]>;
  reset: () => Promise<T[]>;
  emptyEntry: T; // template used for a new entry
  primaryText: (entry: T) => string;
  secondaryText: (entry: T) => string;
  onSaved?: () => void; // notify the app after a successful save/reset
}

type Draft = Record<string, unknown>;

const getPath = (obj: Draft, path: string): unknown =>
  path.split(".").reduce<unknown>(
    (acc, key) => (acc == null ? undefined : (acc as Draft)[key]),
    obj,
  );

const setPath = (obj: Draft, path: string, value: unknown): Draft => {
  const keys = path.split(".");
  const next = structuredClone(obj);
  let cur = next as Draft;
  for (let i = 0; i < keys.length - 1; i += 1) cur = cur[keys[i]] as Draft;
  cur[keys[keys.length - 1]] = value;
  return next;
};

/**
 * Reusable Settings section for editing a curated JSON catalog (generation models
 * or engines): lists entries with add / edit / remove via a per-field structured
 * dialog, and a reset-to-defaults action. Each add / edit / delete persists the
 * full list through `save`, and `reset` restores the bundled defaults. Driven
 * entirely by a declarative `FieldSpec[]`, so both catalogs share this one file.
 */
export const CatalogEditor = <T,>({
  title,
  description,
  fields,
  load,
  save,
  reset,
  emptyEntry,
  primaryText,
  secondaryText,
  onSaved,
}: CatalogEditorProps<T>) => {
  const t = useTranslations();
  const [entries, setEntries] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ mode: "add" | "edit"; index: number } | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [pendingReset, setPendingReset] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    load()
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(() => reload(), [reload]);

  const persist = async (next: T[]): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      setEntries(await save(next));
      onSaved?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setDraft(structuredClone(emptyEntry) as Draft);
    setEditing({ mode: "add", index: -1 });
  };
  const openEdit = (index: number) => {
    setDraft(structuredClone(entries[index]) as Draft);
    setEditing({ mode: "edit", index });
  };

  const buildEntry = (): T => {
    let out = structuredClone(draft);
    for (const f of fields) {
      if ((f.type === "text" || f.type === "select") && f.nullable) {
        if (getPath(out, f.key) === "") out = setPath(out, f.key, null);
      }
    }
    return out as T;
  };

  const submit = async () => {
    if (editing === null) return;
    const entry = buildEntry();
    const next =
      editing.mode === "add"
        ? [...entries, entry]
        : entries.map((e, i) => (i === editing.index ? entry : e));
    if (await persist(next)) setEditing(null);
  };

  const confirmDelete = async () => {
    if (pendingDelete === null) return;
    const next = entries.filter((_, i) => i !== pendingDelete);
    setPendingDelete(null);
    await persist(next);
  };

  const doReset = async () => {
    setPendingReset(false);
    setBusy(true);
    setError(null);
    try {
      setEntries(await reset());
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const slugValue = String(getPath(draft, "slug") ?? "").trim();

  const renderField = (f: FieldSpec) => {
    const raw = getPath(draft, f.key);
    const onChange = (value: unknown) => setDraft((d) => setPath(d, f.key, value));

    if (f.type === "boolean") {
      return (
        <FormControlLabel
          key={f.key}
          control={
            <Switch checked={Boolean(raw)} onChange={(e) => onChange(e.target.checked)} />
          }
          label={f.label}
        />
      );
    }
    if (f.type === "select") {
      return (
        <TextField
          key={f.key}
          select
          size="small"
          label={f.label}
          value={String(raw ?? "")}
          onChange={(e) => onChange(e.target.value)}
          fullWidth
        >
          {(f.options ?? []).map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      );
    }
    return (
      <TextField
        key={f.key}
        size="small"
        label={f.label}
        type={f.type === "number" ? "number" : "text"}
        value={f.type === "number" ? Number(raw ?? 0) : String(raw ?? "")}
        onChange={(e) =>
          onChange(f.type === "number" ? Number(e.target.value) : e.target.value)
        }
        multiline={f.type === "multiline"}
        minRows={f.type === "multiline" ? 2 : undefined}
        inputProps={
          f.type === "number" ? { min: f.min, max: f.max, step: f.step ?? 1 } : undefined
        }
        fullWidth
      />
    );
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <SectionHeading level={2}>{title}</SectionHeading>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            color="inherit"
            startIcon={<RestartAltIcon />}
            onClick={() => setPendingReset(true)}
            disabled={busy || loading}
          >
            {t("settings.catalog.reset")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={openAdd}
            disabled={busy || loading}
          >
            {t("settings.catalog.add")}
          </Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <LoadingIndicator label={t("common.loading")} />
      ) : entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("settings.catalog.empty")}
        </Typography>
      ) : (
        <List dense disablePadding>
          {entries.map((entry, index) => (
            <ListItem
              key={primaryText(entry) + index}
              disableGutters
              secondaryAction={
                <>
                  <IconButton
                    size="small"
                    onClick={() => openEdit(index)}
                    aria-label={t("settings.catalog.edit")}
                    disabled={busy}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setPendingDelete(index)}
                    aria-label={t("settings.catalog.delete")}
                    disabled={busy}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </>
              }
            >
              <ListItemText
                primary={primaryText(entry)}
                secondary={secondaryText(entry)}
                secondaryTypographyProps={{ noWrap: true }}
              />
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editing?.mode === "add"
            ? t("settings.catalog.addTitle")
            : t("settings.catalog.editTitle")}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1 }}>
            {fields.map((f) => (
              <Box
                key={f.key}
                sx={{ flex: f.type === "multiline" ? "1 1 100%" : "1 1 220px", minWidth: 0 }}
              >
                {renderField(f)}
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <Button variant="contained" onClick={submit} disabled={busy || slugValue === ""}>
            {t("settings.catalog.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("common.confirmDeleteTitle")}
        message={t("settings.catalog.deleteConfirm")}
        confirmLabel={t("settings.catalog.delete")}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={pendingReset}
        title={t("settings.catalog.reset")}
        message={t("settings.catalog.resetConfirm")}
        confirmLabel={t("settings.catalog.reset")}
        onConfirm={doReset}
        onClose={() => setPendingReset(false)}
      />
    </Paper>
  );
};
