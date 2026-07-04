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
- app/generate|models|upscale|gallery|settings/page.tsx — one route per screen
                             (thin clients reading AppData/Generation context)
- src/app-shell/AppChrome.tsx — shared chrome above all routes: AppBar, link-based
                             tabs (active from usePathname), status bar; holds the
                             AppData context (models/system) and the GenerationProvider
- src/theme/                — theme tokens: Inter font (loaded by next/font in
                             app/layout.tsx, read via the `--font-inter` CSS var),
                             a cohesive light/dark palette (background/paper/divider/
                             text, AA contrast), the type scale, `fontWeightMedium`
                             emphasis token and `layout` size tokens (incl.
                             `contentMaxWidth`) + ColorModeProvider
- src/i18n/                 — minimal i18n provider + `useTranslations`
- src/locales/en.json       — all static UI text (default locale)
- src/lib/api.ts            — typed backend client (REST)
- src/lib/ws.ts             — reconnecting multiplexed WebSocket client (`live`) +
                             `useLive` hook: subscribes a channel and falls back to
                             REST polling while the socket is down. Used for
                             generation/upscale progress, system stats and downloads
- src/types/                — API response types
- src/generation/          — GenerationProvider: always-mounted context holding the
                             form + running job so generation survives navigation
- src/activity/           — ActivityProvider: generic off-route status store any
                             task publishes into (id/title/route/status/detail/
                             percent); DownloadProvider: app-level download tracking
                             (survives navigation) that feeds both the inline bars
                             and the activity store. One ActivityOverlay renders all.
- src/upscale/             — UpscaleProvider: always-mounted context holding the
                             upscale job + polling AND the form (engine/source/
                             upscaler+outpaint prompts/outpaint engine/tiling) so a
                             run and its settings survive
                             navigation (progress/result/selection restored when
                             returning to /upscale); stats.ts derives the status
                             line + percent shared by the frame and overlay
- src/lib/fit.ts            — maps a GPU-fit verdict to chip color + locale keys
- src/components/atoms/     — SectionHeading (semantic h2/h3 with a visual variant),
                             Logo (the app mark, mirrors app/icon.svg)
- src/components/molecules/ — LabeledSlider, ModelListItem, GalleryCard, InfoTip,
                             ConfirmDialog, ConnectionStatus, NavDrawer (mobile nav),
                             ActivityBubble (one off-route status card)
- src/components/organisms/ — GenerationPanel (thin two-column host) + GenerationForm
                             + GenerationResult, ModelManager, EngineManager,
                             AddEngineDialog, GalleryPanel, SettingsPanel,
                             SystemStatusBar, InferenceOverlay, AddModelDialog,
                             ReferenceImage, PromptSnippets, PromptSnippetManager,
                             UpscalePanel

# Key Components
- AppChrome       — mounted in the root layout, wraps every route. Loads models +
                    system into an AppData context, hosts GenerationProvider, renders
                    the nav (Next Link tabs), the status bar and the overlay gate.
                    The main content Container is width-capped by the theme's
                    `layout.contentMaxWidth` token (~1700px) and centered.
                    Because it lives above the routes, client-side navigation keeps
                    the running generation alive; a full reload restores the route.
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
                    upload + img2img (strength) or IP-Adapter style (scale, SD1.5/SDXL)
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
                    a target aspect ratio + reframe strategy (cover/contain/edge/
                    outpaint); for outpaint pick the inpaint model (dropdown, curated
                    or custom, downloaded on demand); separate upscaler prompt and
                    outpaint prompt (each with an upscale snippet control) and a
                    tiling toggle, run the job (via UpscaleProvider) and view/open
                    the saved result; the result frame shows live stats
                    (phase incl. outpainting / tile+step progress / elapsed)
- SettingsPanel   — HF token + performance toggles (VAE tiling/slicing, xformers)
                    + system info; the /settings page also renders the
                    PromptSnippetManager below it

# Conventions
- MUI standard components with minimal component-level overrides
- Styling via Emotion `sx`; design values come from the theme, not magic values
- No hard-coded UI text — everything goes through `useTranslations` + locale files
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
