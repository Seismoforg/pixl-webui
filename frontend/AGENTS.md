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
- app/generate|models|upscale|reframe|inpaint|edit|gallery|settings/page.tsx — one
                             route per screen (thin clients reading AppData/Generation
                             context); `/edit` is the Post Processing (FLUX Kontext) page
- src/app-shell/AppChrome.tsx — shared VISUAL chrome above all routes: AppBar,
                             link-based tabs (active from usePathname), status bar,
                             activity overlay. Shared data + feature providers now
                             live in providers/AppDataProvider (which wraps it)
- src/providers/            — all app-level context providers (see providers/AGENTS.md):
                             AppDataProvider (shared models/system + `useAppData`;
                             hosts the feature providers), ColorModeProvider,
                             GenerationProvider, UpscaleProvider, ReframeProvider,
                             InpaintProvider, EditProvider, ActivityProvider,
                             DownloadProvider.
                             Grouped here so navigation-surviving state has one home
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
                             stats.ts (upscale status line + percent), reframe.ts +
                             inpaint.ts (client-side geometry / mask-overlay math),
                             formLock.ts (shared form-lock fieldset style)
- src/types/                — API response types
- src/components/           — atomic-design component library (atoms/molecules/
                             organisms); see src/components/AGENTS.md for the catalog

# Key Components
- AppDataProvider — mounted in the root layout, wraps AppChrome. Loads models +
                    system into an AppData context (`useAppData`) and hosts the
                    always-mounted feature providers (activity, downloads,
                    generation, upscale, reframe, inpaint, edit), so client-side
                    navigation keeps a running generation/upscale/reframe/inpaint/edit
                    job alive. Loads once on mount; model changes are
                    pushed via `reloadModels()` from the relevant handlers (no
                    per-navigation refetch).
- AppChrome       — the VISUAL chrome inside AppDataProvider: renders the nav (Next
                    Link tabs), the status bar and the overlay gate. The main content
                    Container is width-capped by the theme's `layout.contentMaxWidth`
                    token (~1700px) and centered.
                    Responsive: the tab bar shows at md+; below md a burger button
                    opens the NavDrawer instead (all via MUI sx breakpoints).
                    Publishes the sticky AppBar's live height as the `--app-header-h`
                    CSS var (ResizeObserver) so the sticky result panels
                    (Generation/Upscale/Reframe/Inpaint/Edit) can offset their `top` below
                    it — otherwise the box's top edge + heading clip behind the AppBar.
- Components      — the atoms/molecules/organisms catalog + their Key Components live in
                    src/components/AGENTS.md; the feature state providers in
                    src/providers/AGENTS.md

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
- Child: ./src/components (atomic-design component library)
- Child: ./src/providers (app-level context providers)
- Child: ./src/lib (typed REST + WebSocket clients, pure helpers)
- Child: ./e2e (Playwright inspect harness; launched by root test-frontend.bat)
