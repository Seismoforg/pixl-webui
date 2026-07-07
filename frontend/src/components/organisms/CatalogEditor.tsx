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
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { CatalogEntryRow } from "@/components/molecules/CatalogEntryRow";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { useTranslations } from "@/i18n";
import { getPath, setPath, type Draft } from "@/lib/objectPath";
import { useDownloads } from "@/providers/DownloadProvider";
import type { DownloadStatus, FitInfo } from "@/types";

// Dialog field grid: min width before a field wraps to its own row.
const FIELD_MIN_WIDTH = 220;

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

/** On-disk + fit extras a runtime list (`/api/models` etc.) adds to a catalog
 *  entry; the editor joins the two by `slug`. */
export interface CatalogRuntime {
  slug: string;
  downloaded: boolean;
  status: DownloadStatus;
  fit?: FitInfo; // models/engines only; LoRAs have no fit verdict
}

/**
 * Optional rich-display config. When passed, the editor loads the runtime list too,
 * joins it to the catalog by slug, and renders grouped rich rows (badges + install /
 * delete) instead of the plain text list — while keeping the add/edit/remove/reset
 * lifecycle unchanged. Omit it and the editor keeps its plain-list fallback.
 */
export interface CatalogDisplay<T> {
  // Runtime list (install-state + fit); only slug/downloaded/status/fit are read,
  // the catalog supplies the rest — so the flatter engine runtime shape fits too.
  loadRuntime: () => Promise<CatalogRuntime[]>;
  groupBy: (entry: T & CatalogRuntime) => string; // display-ready section label
  sortWithin?: (a: T & CatalogRuntime, b: T & CatalogRuntime) => number;
  renderBadges: (entry: T & CatalogRuntime) => ReactNode;
  onDownload: (entry: T & CatalogRuntime) => Promise<void>; // start + track the download
  onDeleteDownload: (slug: string) => Promise<void>; // remove weights from disk
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
  display?: CatalogDisplay<T>; // present → rich grouped rows; absent → plain list
}

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
  display,
}: CatalogEditorProps<T>) => {
  const t = useTranslations();
  const downloads = useDownloads();
  const [entries, setEntries] = useState<T[]>([]);
  const [runtime, setRuntime] = useState<CatalogRuntime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ mode: "add" | "edit"; index: number } | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [pendingDiskDelete, setPendingDiskDelete] = useState<string | null>(null);
  const [pendingReset, setPendingReset] = useState(false);

  const slugOf = (entry: T): string =>
    String(getPath(entry as unknown as Draft, "slug") ?? "").trim();

  const reload = useCallback(() => {
    setLoading(true);
    load()
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(() => reload(), [reload]);

  // Rich-display path: load the runtime list (install-state + fit) alongside the
  // catalog and reload it after any install change (best-effort — badges degrade
  // to catalog-only if it fails).
  const loadRuntime = display?.loadRuntime;
  const reloadRuntime = useCallback(() => {
    if (!loadRuntime) return;
    loadRuntime()
      .then(setRuntime)
      .catch(() => {});
  }, [loadRuntime]);
  useEffect(() => reloadRuntime(), [reloadRuntime]);

  // Flip install-state once a tracked download finishes (mirrors EngineManager).
  useEffect(() => {
    if (runtime.some((r) => !r.downloaded && downloads.progress[r.slug]?.status === "done")) {
      reloadRuntime();
    }
  }, [downloads.progress, runtime, reloadRuntime]);

  const persist = async (next: T[]): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      setEntries(await save(next));
      onSaved?.();
      reloadRuntime();
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
    setError(null);
    setEditing({ mode: "add", index: -1 });
  };
  const openEdit = (index: number) => {
    setDraft(structuredClone(entries[index]) as Draft);
    setError(null);
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
    const newSlug = String(getPath(entry as unknown as Draft, "slug") ?? "").trim();
    const collides = entries.some(
      (e, i) =>
        i !== editing.index &&
        String(getPath(e as unknown as Draft, "slug") ?? "").trim() === newSlug,
    );
    if (collides) {
      setError(t("settings.catalog.duplicateSlug"));
      return;
    }
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
      reloadRuntime();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Install actions (rich path). Download progress flows through the shared
  // DownloadProvider; a completed download is reflected by the done-effect above.
  const handleDownload = async (entry: T & CatalogRuntime) => {
    setError(null);
    try {
      await display?.onDownload(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const confirmDiskDelete = async () => {
    const slug = pendingDiskDelete;
    setPendingDiskDelete(null);
    if (slug === null) return;
    setError(null);
    try {
      await display?.onDeleteDownload(slug);
      reloadRuntime();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
          control={<Switch checked={Boolean(raw)} onChange={(e) => onChange(e.target.checked)} />}
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
        onChange={(e) => onChange(f.type === "number" ? Number(e.target.value) : e.target.value)}
        multiline={f.type === "multiline"}
        minRows={f.type === "multiline" ? 2 : undefined}
        inputProps={f.type === "number" ? { min: f.min, max: f.max, step: f.step ?? 1 } : undefined}
        fullWidth
      />
    );
  };

  const fieldOf = (entry: T, key: string): string | null => {
    const v = getPath(entry as unknown as Draft, key);
    return v == null ? null : String(v);
  };
  const indexOfSlug = (slug: string) => entries.findIndex((e) => slugOf(e) === slug);

  // Rich path: join each catalog entry to its runtime counterpart (by slug), then
  // group into display sections in first-appearance order, installed-first within.
  const grouped = (() => {
    if (!display) return null;
    const joined: Array<T & CatalogRuntime> = entries.map((cat) => {
      const rt = runtime.find((r) => r.slug === slugOf(cat));
      return {
        ...cat,
        slug: slugOf(cat),
        downloaded: rt?.downloaded ?? false,
        status: rt?.status ?? "idle",
        fit: rt?.fit,
      } as T & CatalogRuntime;
    });
    const order: string[] = [];
    const map = new Map<string, Array<T & CatalogRuntime>>();
    for (const e of joined) {
      const key = display.groupBy(e);
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(e);
    }
    const sortFn = display.sortWithin ?? ((a, b) => Number(b.downloaded) - Number(a.downloaded));
    for (const key of order) map.get(key)!.sort(sortFn);
    return order.map((key) => ({ key, items: map.get(key)! }));
  })();

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
      ) : display && grouped ? (
        <Stack spacing={3}>
          {grouped.map(({ key, items }) => (
            <Box key={key}>
              <SectionHeading
                level={3}
                variant="subtitle2"
                sx={{ mb: 1.5, color: "text.secondary" }}
              >
                {key} ({items.length})
              </SectionHeading>
              <Stack spacing={1.5}>
                {items.map((e) => (
                  <CatalogEntryRow
                    key={e.slug}
                    name={primaryText(e)}
                    description={fieldOf(e, "description") ?? ""}
                    repoId={fieldOf(e, "repo_id")}
                    badges={display.renderBadges(e)}
                    downloaded={e.downloaded}
                    progress={downloads.progress[e.slug]}
                    onDownload={() => handleDownload(e)}
                    onDeleteDownload={() => setPendingDiskDelete(e.slug)}
                    onEdit={() => openEdit(indexOfSlug(e.slug))}
                    onRemoveFromCatalog={() => setPendingDelete(indexOfSlug(e.slug))}
                    busy={busy}
                  />
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        <List dense disablePadding>
          {entries.map((entry, index) => (
            <ListItem
              key={String(getPath(entry as unknown as Draft, "slug") ?? index)}
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
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1 }}>
            {fields.map((f) => (
              <Box
                key={f.key}
                sx={{
                  flex: f.type === "multiline" ? "1 1 100%" : `1 1 ${FIELD_MIN_WIDTH}px`,
                  minWidth: 0,
                }}
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
        confirmLabel={t("settings.catalog.removeFromCatalog")}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={pendingDiskDelete !== null}
        title={t("common.confirmDeleteTitle")}
        message={t("models.confirmDelete")}
        confirmLabel={t("models.delete")}
        onConfirm={confirmDiskDelete}
        onClose={() => setPendingDiskDelete(null)}
      />
      <ConfirmDialog
        open={pendingReset}
        title={t("settings.catalog.resetTitle")}
        message={t("settings.catalog.resetConfirm")}
        confirmLabel={t("settings.catalog.resetConfirmAction")}
        onConfirm={doReset}
        onClose={() => setPendingReset(false)}
      />
    </Paper>
  );
};
