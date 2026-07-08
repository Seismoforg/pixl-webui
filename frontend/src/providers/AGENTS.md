# Purpose
All app-level React context providers in one place. Everything that owns shared,
navigation-surviving state or wraps the tree in a context lives here.

# Responsibilities
- Hold shared app data (models + system info) and the always-mounted feature
  providers so running jobs and data survive client-side navigation
- Provide the light/dark color mode + MUI theme
- Provide generation, upscale, reframe, inpaint, edit, activity and download contexts
- Persist in-flight job/download ids (via lib/jobPersistence) and rehydrate them on
  mount so a running activity's status bubble survives a full page reload

# File Structure
- AppDataProvider.tsx    — shared models/system state + `useAppData`; hosts the
                           feature providers (activity, downloads, generation,
                           upscale, reframe, inpaint, edit). Loads models/system once; model changes
                           are pushed via `reloadModels()` from the relevant handlers
                           (NOT refetched on every navigation). Exposes `modelsLoading`
                           (true until the first models load resolves) for the Models
                           list skeleton
- ColorModeProvider.tsx  — color mode state + `useColorMode`; builds the MUI
                           theme from `@/theme/theme` and mounts ThemeProvider. Boots
                           to a stable "dark" default (SSR-safe), then on mount applies
                           a stored choice (`pixl.colorMode` in localStorage) else the
                           OS `prefers-color-scheme`; the toggle persists the choice
- GenerationProvider.tsx — generation form (incl. selected `loras: LoraRef[]`) +
                           running job + polling; `useGeneration`
- CompareProvider.tsx    — XYZ-plot compare form (model/prompt/negative/base
                           steps·guidance·seed·sampler·width·height + `axes[]`, each
                           an `{param, values}` sweep, 1–3 axes; `saveIndividuals` flag)
                           + job + live tracking; `useCompare`. Axis param one of
                           steps/guidance/sampler/seed/prompt (prompt value = pos+neg
                           pair). Sweeps a parameter over values into a labelled grid;
                           tracks the job via `CompareProgress` (the `BatchProgress`
                           shape, cell index = batch index) and exposes `resultIds` (one
                           per Z-slice sheet) for the result grid
- UpscaleProvider.tsx    — upscale form + job + polling; `useUpscale`
- ReframeProvider.tsx    — reframe form (source/ratio [+ customWidth/customHeight for a
                           custom exact resolution]/strategy/outpaint prompt +
                           negative + outpaint seam-blend softness:
                           maskFeather/seamFeather/seedBlur +
                           source position posX/posY + source scale (shrinks the
                           source within the frame; area-adding strategies), all
                           0–100 % + outpaint
                           generation params: sampler/steps/refineSteps/guidance/
                           seed/batch + a refine flag (off by default) gating the
                           slow full-res hires refine pass, with the sampler list
                           fetched once) + job +
                           live tracking; `useReframe`. Reframing changes aspect ratio
                           WITHOUT upscaling; tracks the job via the `ReframeProgress`
                           shape (the upscale shape + batch fields) and exposes
                           `resultIds` for the batch result grid; reuses the
                           `UpscaleSource` type
- InpaintProvider.tsx    — inpaint form (source/painted-mask data URL/engine/prompt/
                           negative + brush size+softness + feather softness
                           mask/seam/seedBlur, all 0–100 % + generation params
                           sampler/steps/refineSteps/guidance/seed/batch + a refine
                           flag off by default; sampler list fetched once) + job +
                           live tracking; `useInpaint`. Repaints a painted region
                           WITHOUT resizing; tracks the job via `InpaintProgress` (the
                           `ReframeProgress` shape) and exposes `resultIds` for the
                           batch grid; reuses the `UpscaleSource` type
- EditProvider.tsx       — Post-Processing (FLUX Kontext / FLUX.2 klein) edit form
                           (source/edit engine/instruction prompt + generation params
                           steps/guidance/seed/batch + `loras: LoraRef[]` for FLUX/FLUX.2
                           edit engines — no mask, no sampler) + job +
                           live tracking; `useEdit`. Edits a whole image from a
                           written instruction; tracks the job via `EditProgress` (the
                           `InpaintProgress` shape) and exposes `resultIds` for the
                           batch grid; reuses the `UpscaleSource` type
- RestoreProvider.tsx    — photo-restoration form (source/preset/per-station
                           `{enabled?, strength?}` conveyor overrides/beautify prompt +
                           per-role model picks face/upscale/edit/zimage, "" = Auto) +
                           job + live tracking; `useRestore`. Tracks the job via
                           `RestoreProgress` (UpscaleProgress + preset/current_station/
                           analysis/per-station results); reuses `UpscaleSource`
- ActivityProvider.tsx   — generic off-route status store; `useActivity`
- DownloadProvider.tsx   — app-level download tracking; `useDownloads` +
                           `trackUpscalerDownload` / `trackLoraDownload` helpers (start +
                           track an engine/LoRA download; shared by EngineManager +
                           UpscalePanel / LoraPicker)

# Key Components
- AppDataProvider — wraps AppChrome in the root layout; the top of the provider
  tree for shared data. Consumers read it via `useAppData`.

# Dependencies
react, @mui/material, @/lib (api, useJob, useSamplers), @/theme, @/i18n. The 6
feature providers run their whole job lifecycle through `@/lib/useJob` (state +
start + tracking + rehydrate + activity + reset; generation opts out of the shared
bubble and publishes its own) and memoize their context value. The `UpscaleSource`
type lives in `@/types`.

# Related Modules
- Parent: ../../ (frontend)
- Uses: ../lib (typed API + WebSocket clients), ../theme (theme tokens)
