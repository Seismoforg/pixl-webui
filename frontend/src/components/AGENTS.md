# Purpose
Atomic-design React component library for the Pixl WebUI frontend: presentational
(atoms/molecules) + composed feature UI (organisms). Job/data state lives in
`../providers`; pure geometry/math in `../lib`; components stay view-only.

# Responsibilities
- Render the UI for every screen (generate/models/upscale/reframe/inpaint/edit/gallery/settings)
- Compose reusable presentational blocks (atoms → molecules → organisms)
- Consume provider context + lib helpers; hold no cross-navigation job state
- Enforce a11y (labels/aria/focus/WCAG AA) + i18n (all text via `useTranslations`)

# File Structure
## atoms/
- SectionHeading — visual variant + correct semantic element (h2 titles, h3 sub)
- Logo — app mark, mirrors app/icon.svg
- MonoText — inline numeric readout in the tabular mono family
  (`theme.typography.fontFamilyMono` + tabular-nums); for telemetry, seeds, sizes,
  dimensions, percentages so numbers align and read as instrument values

## molecules/
- LabeledSlider — labelled slider
- FieldWithInfo — a form field (TextField/select) + trailing InfoTip in one row;
  the shared wrapper for GenerationForm's fields
- SectionHeadingWithInfo — SectionHeading + InfoTip header row (GenerationParams,
  BrushControls)
- BrushControls — brush size + softness sliders (inpaint mask editor)
- GenerationParams — shared sampler/steps/refine/guidance/batch/seed block;
  presentational, keyed by an i18n `keyPrefix`; reused by Reframe/Inpaint/Edit
  panels (optional sampler + refine controls hidden when omitted)
- ModelListItem — one model as a compact list row (name + GGUF tag + chips + fit
  badge + HF link + download/delete + progress bar)
- GalleryCard — gallery image card (inline regenerate/upscale/delete + detail dialog)
- InfoTip — info tooltip
- ConfirmDialog — confirm dialog
- ConnectionStatus — WS connection indicator
- NavDrawer — mobile nav drawer (260px)
- ActivityBubble — one off-route status card (300px)
- UpscaleStats — upscale status line (shared by frame/overlay)
- Thumbnail — square next/image thumbnail (downscaled variant; gallery/picker/batch grids)
- SourceInfo — compact source facts (full-res size + gallery seed/prompt/model)
- LoadingIndicator — inline centered spinner + caption (not a global overlay)
- ResultPlaceholder — composed idle/empty state for the result panels (soft icon +
  short hint); shared by all 5 job-result organisms instead of a bare muted line
- SkeletonCardGrid / SkeletonList — skeleton placeholders mirroring card-grid/list
  layouts (avoid reflow on load)
- ReframePreview — static canvas preview of a reframe layout (target frame + source
  placement + new/cropped region; client-side geometry from ../../lib/reframe, no
  generation run; reflects pos_x/pos_y; outpaint draws alpha-gradient bands tracking
  mask/seam feather; fills parent width). `overlay` variant = frame decorations only
  (tint/seam/crop lines, source region punched transparent) for ReframeResult

## organisms/
- GenerationPanel (thin two-column host) + GenerationForm + GenerationResult
- ModelManager — catalog list, filter bar (search + family + pipeline), grouped by
  install state then GPU fit; download/progress/delete. Read-only over the catalog
  (edited in Settings). Generation models only
- EngineManager — Models-page section for upscale/outpaint engines, same grouping +
  per-row fit badge; install/progress/delete via DownloadProvider
- GalleryPanel — stored-images grid with search/model-filter; upscale action
  deep-links to /upscale?image=<id>
- GalleryPicker / SourcePicker — pick a gallery image / choose source (gallery or upload)
- SettingsPanel — HF token + perf toggles + SD x4 steps + outpaint-negative default +
  Defaults section (default model/upscaler/outpaint engine) + system info
- CatalogEditor (+ CuratedModelsEditor / CuratedEnginesEditor) — edit a curated JSON
  catalog via a declarative `FieldSpec[]` dialog + reset; each change PUTs the whole list
- EnginePicker — shared engine picker (upscale/outpaint/inpaint/edit); defaults
  reproduce the Upscale look, compact callers override label/helperText/showDetails
- BatchImageResult — shared sticky batch-image result panel (icon/keyPrefix/running/
  progress/resultIds + overlay slots); UpscaleResult/ReframeResult/InpaintResult/
  EditResult are thin wrappers over it
- SystemStatusBar — polls /api/system/stats; CPU/RAM/GPU/VRAM meters on every page
- ActivityOverlay — one shared overlay: floating bubble per off-route running activity;
  tap navigates there
- ReferenceImage — optional reference-image conditioning (upload OR gallery; SourceInfo
  readout; img2img strength OR IP-Adapter style scale, SD1.5/SDXL)
- PromptSnippets / PromptSnippetManager / SnippetPromptField — reusable snippet control,
  Settings CRUD section, and snippet-control + prompt-field combo
- UpscalePanel (host) + UpscaleResult — /upscale screen (engine + source + prompt +
  per-run SD x4 steps + tiling; live stats)
- ReframePanel (host) + ReframeResult — /reframe screen (source + target ratio/custom
  W×H + strategy; outpaint = engine + prompts + seam-blend sliders + source scale/
  position + gen params). ReframeResult is the sticky column hosting ReframePreview,
  live stats, batch grid + an overlay-toggle recalling the planned layout
- InpaintPanel (host) + InpaintCanvas + InpaintResult — /inpaint screen. InpaintCanvas
  = paint-a-mask editor (source + mask-overlay canvas visualizing the 3 feather
  controls live via ../../lib/inpaint + cursor canvas drawing brush rings; stores mask
  at source res white-on-transparent, exports flattened onto black = repaint)
- EditPanel (host) + EditResult — /edit "Post Processing" screen (FLUX.1 Kontext
  prompt-based whole-image edit; source + engine + instruction + gen params, no mask/sampler)

# Key Components
- InpaintCanvas — the only stateful/interactive canvas: coalesces blur-heavy overlay
  repaints to one per requestAnimationFrame (INP); `touchAction: "none"`; role="img"
  + aria-label
- CatalogEditor — declarative `FieldSpec[]`-driven editor reused for both catalogs
- GenerationParams — the single shared gen-params block; keeps Reframe/Inpaint/Edit
  forms consistent

# Conventions
- MUI + Emotion `sx`; design values from the theme, never magic values
- No hard-coded UI text — everything via `useTranslations` + locale files
- Accessibility first: labels/aria, focus, keyboard, WCAG AA; headings via SectionHeading
- Small images via `next/image` (Thumbnail); `data:` URLs bypass the optimizer

# Dependencies
next, react, @mui/material, @mui/icons-material, @emotion/react;
../providers (state), ../lib (helpers), ../i18n, ../theme.

# Related Modules
- Parent: ../../ (frontend)
- Uses: ../providers (job/data state), ../lib (geometry/API helpers)
