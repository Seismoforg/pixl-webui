# Purpose
All app-level React context providers in one place. Everything that owns shared,
navigation-surviving state or wraps the tree in a context lives here.

# Responsibilities
- Hold shared app data (models + system info) and the always-mounted feature
  providers so running jobs and data survive client-side navigation
- Provide the light/dark color mode + MUI theme
- Provide generation, upscale, activity and download contexts

# File Structure
- AppDataProvider.tsx    — shared models/system state + `useAppData`; hosts the
                           feature providers (activity, downloads, generation,
                           upscale). Loads models/system once; model changes are
                           pushed via `reloadModels()` from the relevant handlers
                           (NOT refetched on every navigation)
- ColorModeProvider.tsx  — color mode state + `useColorMode`; builds the MUI
                           theme from `@/theme/theme` and mounts ThemeProvider
- GenerationProvider.tsx — generation form + running job + polling; `useGeneration`
- UpscaleProvider.tsx    — upscale form + job + polling; `useUpscale`
- ActivityProvider.tsx   — generic off-route status store; `useActivity`
- DownloadProvider.tsx   — app-level download tracking; `useDownloads`

# Key Components
- AppDataProvider — wraps AppChrome in the root layout; the top of the provider
  tree for shared data. Consumers read it via `useAppData`.

# Dependencies
react, @mui/material, @/lib (api, ws), @/theme, @/i18n

# Related Modules
- Parent: ../  (frontend/src, via ../../AGENTS.md)
- Uses: ../lib (typed API + WebSocket clients), ../theme (theme tokens)
