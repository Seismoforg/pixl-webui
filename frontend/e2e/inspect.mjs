// Attach to the shared browser (shared-browser.mjs) over CDP, read its ACTIVE page,
// and report: a screenshot (PNG for Claude to Read) + exact element metrics (box model
// + computed styles + spacing + overflow). Flags: --a11y (axe-core violations),
// --console (console + failed requests, captured over a short reload window),
// --goto <route|url> (navigate the active tab first — a bare route like `models` is
// resolved against APP_BASE; a full http(s) URL is used as-is),
// --device <mobile|tablet|desktop|WxH> (emulate a device viewport via CDP for THIS run,
// then auto-clear — a cross-process reset is unreliable, so scope is per-run).
//
// Usage: node e2e/inspect.mjs [selector] [--a11y] [--console] [--goto <route>] [--device <d>] [--name <label>]
// Env:   CDP_PORT (default 9222), APP_BASE (default http://localhost:3000).

import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const screensDir = resolve(here, "screens");
const cdpPort = process.env.CDP_PORT ?? "9222";
const appBase = (process.env.APP_BASE ?? "http://localhost:3000").replace(/\/$/, "");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const selector = args.find((a) => !a.startsWith("--")) ?? "body";
const label = opt("name", "inspect");
const goto = opt("goto", null);
// Resolve --goto: a full http(s) URL is used verbatim, a bare route joins onto APP_BASE.
const gotoUrl = goto && (/^https?:\/\//.test(goto) ? goto : `${appBase}/${goto.replace(/^\//, "")}`);

// Device presets for --device (applied as a CDP metrics override, since the shared
// browser runs with viewport:null so page.setViewportSize() is unavailable).
const DEVICES = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
};
// Resolve --device: a preset name or a custom `WxH` (e.g. 375x667). Applied for this
// run only, then cleared (a cross-process reset is unreliable — see main()).
const resolveDevice = (v) => {
  if (!v) return null;
  if (DEVICES[v]) return DEVICES[v];
  const m = /^(\d+)x(\d+)$/.exec(v);
  if (m) return { width: Number(m[1]), height: Number(m[2]), deviceScaleFactor: 1, mobile: false };
  throw new Error(`--device: unknown "${v}" (use mobile|tablet|desktop|WxH)`);
};

// Pull box model + key computed styles for up to 20 matches of `sel`.
const measure = (sel) =>
  Array.from(document.querySelectorAll(sel))
    .slice(0, 20)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const g = (p) => cs.getPropertyValue(p);
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 48),
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        font: `${g("font-size")}/${g("line-height")} ${g("font-weight")}`,
        color: g("color"),
        background: g("background-color"),
        padding: g("padding"),
        margin: g("margin"),
        gap: g("gap"),
        border: `${g("border-width")} ${g("border-style")} ${g("border-color")}`,
        borderRadius: g("border-radius"),
        display: g("display"),
        overflow: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      };
    });

const main = async () => {
  const device = resolveDevice(opt("device", null));
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context — is shared-browser.mjs running?");
  const pages = context.pages();
  // Prefer the app tab, else the last-opened page.
  const page =
    pages.find((p) => p.url().includes("localhost:3000")) ?? pages[pages.length - 1];
  if (!page) throw new Error("No open page to inspect.");

  // Drive the active tab to a new route/URL before inspecting (e.g. walk the nav).
  if (gotoUrl) {
    await page.goto(gotoUrl, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(500); // let client-side render settle
  }

  // Emulate a device viewport via CDP for THIS run, then clear it below. A CDP metrics
  // override survives the process, but only the setting session can clear it — so a
  // cross-process `--device reset` is unreliable; instead each run is self-contained.
  let deviceClient = null;
  if (device) {
    deviceClient = await context.newCDPSession(page);
    await deviceClient.send("Emulation.setDeviceMetricsOverride", {
      width: device.width,
      height: device.height,
      deviceScaleFactor: device.deviceScaleFactor,
      mobile: device.mobile,
    });
    // maxTouchPoints must be >=1 when enabling; omit it when disabling.
    await deviceClient.send(
      "Emulation.setTouchEmulationEnabled",
      device.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
    );
    await page.waitForTimeout(200); // let the layout reflow at the new size
  }

  mkdirSync(screensDir, { recursive: true });
  const shot = resolve(screensDir, `${label}.png`);
  await page.screenshot({ path: shot });

  // Report the ACTUAL layout viewport (reflects any CDP override; page.viewportSize()
  // is null under viewport:null).
  const report = { url: page.url(), selector };
  report.viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
  report.elements = await page.evaluate(measure, selector);

  if (flag("a11y")) {
    const res = await new AxeBuilder({ page }).analyze();
    report.a11y = res.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.flatMap((n) => n.target).slice(0, 8),
    }));
  }

  if (flag("console")) {
    const logs = [];
    page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
    page.on("requestfailed", (r) => logs.push(`REQFAIL ${r.url()} ${r.failure()?.errorText ?? ""}`));
    await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    report.console = logs.slice(0, 40);
  }

  console.log(`[inspect] screenshot → ${shot}`);
  console.log(JSON.stringify(report, null, 2));

  // Revert the emulation in the SAME session that set it, so the shared window returns
  // to its real size for the next run (must run before the session detaches).
  if (deviceClient) {
    await deviceClient.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await deviceClient.send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
  }
  await browser.close(); // disconnects CDP only; the user's browser stays open
};

main().catch((err) => {
  console.error(`[inspect] ${err.message}`);
  process.exit(1);
});
