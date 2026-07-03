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
- app/generate|models|gallery|settings/page.tsx — one route per screen (thin
                             clients reading AppData/Generation context)
- src/app-shell/AppChrome.tsx — shared chrome above all routes: AppBar, link-based
                             tabs (active from usePathname), status bar; holds the
                             AppData context (models/system) and the GenerationProvider
- src/theme/                — theme tokens (type scale, `fontWeightMedium`
                             emphasis token, `layout` size tokens) + ColorModeProvider
- src/i18n/                 — minimal i18n provider + `useTranslations`
- src/locales/en.json       — all static UI text (default locale)
- src/lib/api.ts            — typed backend client
- src/types/                — API response types
- src/generation/          — GenerationProvider: always-mounted context holding the
                             form + running job so generation survives navigation
- src/lib/fit.ts            — maps a GPU-fit verdict to chip color + locale keys
- src/components/atoms/     — SectionHeading (semantic h2/h3 with a visual variant),
                             Logo (the app mark, mirrors app/icon.svg)
- src/components/molecules/ — LabeledSlider, ModelCard, GalleryCard, InfoTip,
                             ConfirmDialog
- src/components/organisms/ — GenerationPanel (thin two-column host) + GenerationForm
                             + GenerationResult, ModelManager, GalleryPanel,
                             SettingsPanel, SystemStatusBar, InferenceOverlay,
                             AddModelDialog, ReferenceImage, PromptSnippets,
                             PromptSnippetManager

# Key Components
- AppChrome       — mounted in the root layout, wraps every route. Loads models +
                    system into an AppData context, hosts GenerationProvider, renders
                    the nav (Next Link tabs), the status bar and the overlay gate.
                    Because it lives above the routes, client-side navigation keeps
                    the running generation alive; a full reload restores the route.
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
- PromptSnippets  — reusable per-field control (positive/negative) to append a
                    saved snippet and to save/delete snippets (/api/prompt-templates)
- PromptSnippetManager — Settings-page section listing positive/negative snippets
                    with add/edit/delete (full CRUD over /api/prompt-templates)
- SystemStatusBar — polls /api/system/stats; CPU/RAM/GPU/VRAM meters on every page
- InferenceOverlay— floating, backdrop-free progress card shown while generating on
                    a route other than /generate (position:fixed Paper, not a Modal)
- ModelManager    — catalog grid (curated first, then user-added) with download/
                    progress polling + delete-from-disk; "Add model" opens AddModelDialog
- AddModelDialog  — HuggingFace browser: search/sort diffusers models, filter by
                    family and a multi-select pipeline (default text-to-image),
                    resolve a repo (size/VRAM est/fit/compatibility/pipeline), then
                    download it as a custom model
- ModelCard       — one model: family + pipeline + size/VRAM chips, GPU-fit badge,
                    HF model-card link
- GalleryPanel    — stored images grid with search/model-filter; cards have inline
                    regenerate/delete plus an optional detail dialog
- SettingsPanel   — HF token + system info; the /settings page also renders the
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
