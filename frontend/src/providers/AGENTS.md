# Purpose
All app-level React context providers in one place. Everything that owns shared,
navigation-surviving state or wraps the tree in a context lives here.

# Responsibilities
- Hold shared app data (models + system info) and the always-mounted feature
  providers so running jobs and data survive client-side navigation
- Provide the light/dark color mode + MUI theme
- Provide generation, upscale, reframe, activity and download contexts

# File Structure
- AppDataProvider.tsx    — shared models/system state + `useAppData`; hosts the
                           feature providers (activity, downloads, generation,
                           upscale, reframe). Loads models/system once; model changes
                           are pushed via `reloadModels()` from the relevant handlers
                           (NOT refetched on every navigation). Exposes `modelsLoading`
                           (true until the first models load resolves) for the Models
                           list skeleton
- ColorModeProvider.tsx  — color mode state + `useColorMode`; builds the MUI
                           theme from `@/theme/theme` and mounts ThemeProvider
- GenerationProvider.tsx — generation form + running job + polling; `useGeneration`
- UpscaleProvider.tsx    — upscale form + job + polling; `useUpscale`
- ReframeProvider.tsx    — reframe form (source/ratio/strategy/outpaint) + job +
                           live tracking; `useReframe`. Reframing changes aspect
                           ratio WITHOUT upscaling; reuses the upscale progress
                           shape + `UpscaleSource` type
- ActivityProvider.tsx   — generic off-route status store; `useActivity`
- DownloadProvider.tsx   — app-level download tracking; `useDownloads` +
                           `trackUpscalerDownload` helper (start + track an engine
                           download; shared by EngineManager + UpscalePanel)

# Key Components
- AppDataProvider — wraps AppChrome in the root layout; the top of the provider
  tree for shared data. Consumers read it via `useAppData`.

# Dependencies
react, @mui/material, @/lib (api, ws), @/theme, @/i18n

# Related Modules
- Parent: ../  (frontend/src, via ../../AGENTS.md)
- Uses: ../lib (typed API + WebSocket clients), ../theme (theme tokens)
