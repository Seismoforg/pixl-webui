# Purpose
Playwright inspect harness so Claude can DRIVE + INSPECT the frontend in a real local
browser — screenshot (read the PNG) + exact element metrics (box model + computed
styles) + a11y — to do UX/layout work and self-verify UI changes. Entry point:
repo-root `test-frontend.bat`.

# Responsibilities
- One-click: `test-frontend.bat` starts the backend + frontend DEV server (live reload,
  unlike `start.bat`'s prod build), waits for :3000, then opens the shared browser
- Launch a shared, headed Chromium the USER drives (persistent profile, CDP on :9222),
  pointed at the dev server (:3000)
- On request, attach over CDP to the ACTIVE page and report: screenshot + per-element
  box/computed-style metrics + optional axe a11y + console/network

# File Structure
- lib/shared-browser.mjs — launch persistent headed chromium (CDP `--remote-debugging-
                           port`), open the app, stay alive. Env: APP_URL, CDP_PORT,
                           HEADLESS=1 (default headed)
- inspect.mjs            — `connectOverCDP` → active page → (optional) DRIVE actions →
                           screenshot to screens/ + print metrics JSON for a selector.
                           Flags: `--goto <route|url>` (navigate the tab first — bare
                           route joins `APP_BASE`, full URL used as-is; for walking the
                           nav / self-navigating), `--a11y` (axe violations),
                           `--console` (console + failed requests; live-captured when
                           actions run, else via a reload), `--device
                           <mobile|tablet|desktop|WxH>` (emulate a viewport via CDP for
                           that run — see below), `--name <label>`.
                           ACTION flags (repeatable, run left→right AFTER goto/device,
                           BEFORE the screenshot; each targets `locator(sel).first()`,
                           auto-waits, throws → non-zero exit on failure):
                           `--click`/`--dblclick`/`--hover`/`--scroll`/`--check`/
                           `--uncheck <sel>`, `--fill`/`--type <sel::text>`,
                           `--select <sel::valueOrLabel>` (NATIVE `<select>` only),
                           `--press <sel::Key>` or `<Key>` (bare = page keyboard),
                           `--upload <sel::path>`, `--wait <ms|sel>`. `::` splits on its
                           FIRST match. MUI (non-native) select recipe: `--click
                           <combobox>` then `--click "li[role=option] >> text=<Label>"`.
                           cmd.exe quoting: values with spaces/special chars → call
                           `node e2e/inspect.mjs …` directly (bypasses the .bat)
- screens/              — screenshot output (gitignored)
- .profile/             — persistent shared-browser profile (gitignored)

# Key Components
- shared-browser.mjs — the browser the user drives; must stay running while inspecting
- inspect.mjs — the reporter; `browser.close()` only disconnects CDP, the user's window
  stays open. Picks the `localhost:3000` tab, else the last-opened page
- `--device` viewport emulation — via CDP `Emulation.setDeviceMetricsOverride` (the
  shared browser runs `viewport:null`, so `page.setViewportSize()` is unavailable).
  Scope is PER-RUN: set → inspect → cleared in the same session before disconnect. A
  cross-process reset is impossible (only the setting session can clear an override), so
  each run is self-contained; pass `--device` on every call you want emulated. Presets:
  mobile 390×844, tablet 820×1180, desktop 1440×900; or a custom `WxH`. `report.viewport`
  = actual `window.innerWidth/innerHeight/dpr`

# How Claude uses it
1. Run `test-frontend.bat` (starts backend + frontend dev + the shared window).
2. User prepares a state, says "look at X".
3. Claude: `test-frontend.bat inspect "<selector>" [--a11y]` → Read screens/<label>.png +
   read the metrics → edit CSS (dev server hot-reloads) → re-inspect.

# Deferred (not built — future/on request)
Headless mock harness (mock backend + snap + deterministic self-drive), regression
specs (nav/generate/gallery/errors), live real-GPU generation smoke. See
docs/technical-debt.md.

# Dependencies
@playwright/test (chromium via `npx playwright install chromium`), @axe-core/playwright.

# Related Modules
- Parent: ../  (frontend)
- Drives: the running app (../ frontend served by start.bat)
