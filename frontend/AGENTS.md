# Purpose
Next.js (App Router) frontend for Pixl WebUI: a tidy, accessible MUI UI to pick
and download models, configure settings, and generate images.

# Responsibilities
- Render the generation view (with live step/it-s/seed progress), model manager,
  gallery and settings dialog
- Talk to the backend via a typed API client
- Provide theming (light/dark) and the i18n layer (English default)

# File Structure
- app/layout.tsx            — providers (MUI cache, ColorMode, i18n) + AppChrome
- app/page.tsx              — redirects `/` → `/generate`
- app/generate|models|upscale|reframe|gallery|settings/page.tsx — one route per
                             screen (thin clients reading AppData/Generation context)
- src/app-shell/AppChrome.tsx — shared VISUAL chrome above all routes: AppBar,
                             link-based tabs (active from usePathname), status bar,
                             activity overlay. Shared data + feature providers now
                             live in providers/AppDataProvider (which wraps it)
- src/providers/            — all app-level context providers (see providers/AGENTS.md):
                             AppDataProvider (shared models/system + `useAppData`;
                             hosts the feature providers), ColorModeProvider,
                             GenerationProvider, UpscaleProvider, ReframeProvider,
                             ActivityProvider, DownloadProvider. Grouped here so
                             navigation-surviving state has one home
- src/theme/theme.ts        — theme tokens only: Inter font (loaded by next/font in
                             app/layout.tsx, read via the `--font-inter` CSS var),
                             a cohesive light/dark palette (background/paper/divider/
                             text, AA contrast), the type scale, `fontWeightMedium`
                             emphasis token and `layout` size tokens (incl.
                             `contentMaxWidth`). ColorModeProvider now lives in providers/
- src/i18n/                 — self-contained i18n module: minimal provider +
                             `useTranslations` + locales/en.json (all static UI text)
- src/lib/                  — backend-communication infra + pure helpers
                             (see lib/AGENTS.md): api.ts (typed REST client),
                             ws.ts (reconnecting multiplexed WebSocket `live` +
                             `useLive`), fit.ts (GPU-fit → chip color + locale keys),
                             stats.ts (upscale status line + percent)
- src/types/                — API response types
- src/components/atoms/     — SectionHeading (semantic h2/h3 with a visual variant),
                             Logo (the app mark, mirrors app/icon.svg)
- src/components/molecules/ — LabeledSlider, ModelListItem, GalleryCard, InfoTip,
                             ConfirmDialog, ConnectionStatus, NavDrawer (mobile nav),
                             ActivityBubble (one off-route status card), UpscaleStats
                             (upscale status line shared by the frame/overlay),
                             Thumbnail (square next/image thumbnail — loads a
                             downscaled variant; shared by the gallery/picker/batch
                             grids), SourceInfo (compact source-image facts —
                             full-res size + gallery seed/prompt/model; used by the
                             upscale source preview + picker tiles), LoadingIndicator
                             (inline centered spinner + caption for a parent frame
                             waiting on data — not a global overlay), SkeletonCardGrid
                             / SkeletonList (skeleton placeholders that mirror the
                             card-grid / list layouts to avoid reflow on load),
                             ReframePreview (static canvas preview of a reframe's
                             layout — target-ratio frame + source placement + the
                             new/generated or cropped region; client-side geometry
                             from src/lib/reframe, no generation run)
- src/components/organisms/ — GenerationPanel (thin two-column host) + GenerationForm
                             + GenerationResult, ModelManager, EngineManager,
                             AddEngineDialog, GalleryPanel, GalleryPicker, SettingsPanel,
                             SystemStatusBar, ActivityOverlay, AddModelDialog,
                             ReferenceImage, PromptSnippets, PromptSnippetManager,
                             SnippetPromptField (snippet control + prompt field),
                             UpscalePanel (host) + EnginePicker + SourcePicker +
                             UpscaleResult, ReframePanel (host) + ReframeResult

# Key Components
- AppDataProvider — mounted in the root layout, wraps AppChrome. Loads models +
                    system into an AppData context (`useAppData`) and hosts the
                    always-mounted feature providers (activity, downloads,
                    generation, upscale, reframe), so client-side navigation keeps a
                    running generation/upscale/reframe alive. Loads once on mount;
                    model changes are
                    pushed via `reloadModels()` from the relevant handlers (no
                    per-navigation refetch).
- AppChrome       — the VISUAL chrome inside AppDataProvider: renders the nav (Next
                    Link tabs), the status bar and the overlay gate. The main content
                    Container is width-capped by the theme's `layout.contentMaxWidth`
                    token (~1700px) and centered.
                    Responsive: the tab bar shows at md+; below md a burger button
                    opens the NavDrawer instead (all via MUI sx breakpoints).
- GenerationProvider — holds all generation state + the polling loop in a context
                    that never unmounts; GenerationPanel is a thin consumer
- GenerationPanel — thin two-column host: the sectioned form on the left, the
                    result panel on the right (splits below so no single file is
                    oversized)
- GenerationForm  — the prompt/params form (from context), grouped into labelled
                    sections (Model / Prompt / Reference / Parameters / Output),
                    incl. a sampler dropdown (fetched from /api/samplers), a
                    live-preview toggle, a batch slider, and a PromptSnippets
                    control by each prompt field; submits via a real form onSubmit
- GenerationResult— the result column: live progress, the streamed per-step
                    preview, and the batch result as a selectable thumbnail grid
- SectionHeading  — atom pairing a visual variant with the correct semantic
                    element (h2 page/section titles, h3 sub-sections) so the page
                    keeps a real screen-reader heading outline
- ReferenceImage  — optional reference-image conditioning in the generation form:
                    source from an upload OR a gallery image (picker; fetched to a
                    data URL so the request is unchanged), with a SourceInfo readout
                    (full-res size + gallery seed/prompt/model); img2img (strength)
                    or IP-Adapter style (scale, SD1.5/SDXL)
- PromptSnippets  — reusable per-field control (positive/negative/upscale) to append
                    a saved snippet and to save/delete snippets (/api/prompt-templates)
- PromptSnippetManager — Settings-page section listing positive/negative/upscale
                    snippets with add/edit/delete (full CRUD over /api/prompt-templates)
- SystemStatusBar — polls /api/system/stats; CPU/RAM/GPU/VRAM meters on every page
- ActivityOverlay — one shared overlay: stacks a floating bubble (bottom-right) for
                    every running activity whose home route isn't the current page
                    (generation, upscaling, downloads, …); tapping navigates there.
                    Replaces the old per-feature InferenceOverlay/UpscaleOverlay
- ModelManager    — searchable catalog list with a filter bar (text search +
                    family + pipeline) and models grouped by install state
                    (Installed → Available/curated → Custom), each section
                    counted; download/progress polling + delete-from-disk;
                    "Add model" opens AddModelDialog. Generation models only —
                    upscale/outpaint engines are handled by EngineManager below it
- EngineManager   — Models-page section for upscale/outpaint engines (curated +
                    custom), grouped by install state; install/progress/delete via
                    the app-level DownloadProvider; "Add engine" opens AddEngineDialog
- AddEngineDialog — add a custom engine by repo id + kind (Real-ESRGAN weight / SD x4
                    / inpaint); resolve previews size + (for Real-ESRGAN) the weight-
                    file choices, then download it as a custom engine
- AddModelDialog  — HuggingFace browser: search/sort diffusers models, filter by
                    family and a multi-select pipeline (default text-to-image),
                    resolve a repo (size/VRAM est/fit/compatibility/pipeline), then
                    download it as a custom model
- ModelListItem   — one model as a compact list row: name + origin badge
                    (Curated/Custom) + description, family/pipeline/size/VRAM
                    chips, GPU-fit badge, HF model-card link, and the download/
                    downloaded+delete action with a full-width progress bar
- GalleryPanel    — stored images grid with search/model-filter; cards have inline
                    regenerate/upscale/delete plus an optional detail dialog. The
                    upscale action deep-links to /upscale?image=<id>
- UpscalePanel    — the /upscale screen: pick an engine (Real-ESRGAN / SD x4 +
                    any custom upscaler), choose a source (gallery picker or upload),
                    an upscaler prompt (with an upscale snippet control), a per-run
                    SD x4 step count (seeded from the global default) and a
                    tiling toggle, run the job (via UpscaleProvider) and view/open
                    the saved result; the result frame shows live stats
                    (tile+step progress / elapsed). Upscaling only — reframing lives
                    on its own /reframe screen
- ReframePanel    — the /reframe screen: change an image's aspect ratio WITHOUT
                    upscaling. Choose a source (gallery picker or upload), a target
                    aspect ratio + strategy (cover/contain/edge/outpaint); for
                    outpaint pick the inpaint model (dropdown, curated or custom,
                    downloaded on demand) + an outpaint prompt (upscale snippet
                    control, with an "auto-fill from source" action that reuses a
                    gallery source's own original prompt). Shows a pre-generation
                    ReframePreview of the target frame + new/cropped area. Runs the
                    job via ReframeProvider and shows the saved result with live
                    stats; reuses SourcePicker/GalleryPicker/UpscaleStats.
                    ReframeResult is the result column
- SettingsPanel   — HF token + performance toggles (VAE tiling/slicing, xformers)
                    + SD x4 upscaler step count (number input) + system info; the
                    /settings page also renders the PromptSnippetManager below it

# Conventions
- MUI standard components with minimal component-level overrides
- Styling via Emotion `sx`; design values come from the theme, not magic values
- Thumbnail/small image views use `next/image` (via the `Thumbnail` molecule or
  directly) so the Next optimizer serves downscaled variants instead of full-res
  gallery PNGs; the backend origin is allowlisted in `next.config.mjs`
  (`images.remotePatterns`, derived from `NEXT_PUBLIC_API_BASE`). Full-res is kept
  only for detail/large views; `data:` URLs bypass the optimizer
- No hard-coded UI text — everything goes through `useTranslations` + locale files
- Data loads show inline feedback where the load happens (never a global overlay):
  a `SkeletonCardGrid` / `SkeletonList` when a grid/list layout exists, else a
  centered `LoadingIndicator` with a short caption; wired via the `useAsyncData`
  hook or a local `loading` flag, gated so the skeleton shows only before first data
- Accessibility first: labels/aria, focus visibility, keyboard, WCAG AA contrast
- Heading hierarchy is semantic: one `h1` (app title in AppChrome), page/section
  titles are `h2` and sub-sections `h3` — always via the `SectionHeading` atom,
  never a visual-only `variant`

# Dependencies
next, react, @mui/material, @mui/icons-material, @mui/material-nextjs,
@emotion/react, @emotion/styled.

# Related Modules
- Parent: ../  (project root)
- Peer: ../backend (provides the API)
- Child: ./src/providers (app-level context providers)
- Child: ./src/lib (typed REST + WebSocket clients, pure helpers)
