// Attach to the shared browser (shared-browser.mjs) over CDP, read its ACTIVE page,
// optionally DRIVE interactions (click/fill/select/…), then report: a screenshot (PNG
// for Claude to Read) + exact element metrics (box model + computed styles + spacing +
// overflow). Flags: --a11y (axe-core violations),
// --console (console + failed requests; live-captured when actions run, else over a short
// reload window), --goto <route|url> (navigate the active tab first — a bare route like
// `models` is resolved against APP_BASE; a full http(s) URL is used as-is),
// --device <mobile|tablet|desktop|WxH> (emulate a device viewport via CDP for THIS run,
// then auto-clear — a cross-process reset is unreliable, so scope is per-run).
//
// Action flags (repeatable, run left→right AFTER --goto/--device, BEFORE the screenshot):
// --click/--dblclick/--hover/--scroll/--check/--uncheck <sel>, --fill/--type <sel::text>,
// --select <sel::valueOrLabel> (native <select> only), --press <sel::Key> or <Key>,
// --upload <sel::path>, --wait <ms|sel>. Value separator `::` splits on its FIRST match.
// A failing action throws → non-zero exit (failure is visible). MUI (non-native) selects:
// --click <combobox> then --click "li[role=option] >> text=<Label>".
//
// Usage: node e2e/inspect.mjs [selector] [--goto <route>] [--click <sel>] [--fill <sel::text>] … [--a11y] [--console] [--device <d>] [--name <label>]
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

const ACTION_FLAGS = new Set([
  "click", "dblclick", "fill", "type", "press", "select",
  "check", "uncheck", "hover", "scroll", "upload", "wait",
]);
const VALUE_FLAGS = new Set(["goto", "device", "name"]);
const BOOL_FLAGS = new Set(["a11y", "console"]);

// Ordered argv walk: action flags each consume the next arg (kept in order in
// `actions[]`), value flags (goto/device/name) collect their value, boolean flags
// (a11y/console) toggle, and the first leftover bareword is the positional selector.
// Called from main() so a bad flag surfaces via the same `[inspect] …` handler.
const parseArgs = () => {
  const args = process.argv.slice(2);
  const actions = [];
  const opts = {};
  const bools = {};
  let positional = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      if (positional === null) positional = a;
      continue;
    }
    const name = a.slice(2);
    if (ACTION_FLAGS.has(name)) {
      const payload = args[++i];
      if (payload === undefined) throw new Error(`--${name} needs a value`);
      actions.push({ type: name, payload });
    } else if (VALUE_FLAGS.has(name)) {
      opts[name] = args[++i] ?? null;
    } else if (BOOL_FLAGS.has(name)) {
      bools[name] = true;
    } else {
      throw new Error(`unknown flag --${name}`);
    }
  }
  const goto = opts.goto ?? null;
  // Resolve --goto: a full http(s) URL is used verbatim, a bare route joins onto APP_BASE.
  const gotoUrl = goto && (/^https?:\/\//.test(goto) ? goto : `${appBase}/${goto.replace(/^\//, "")}`);
  return { selector: positional ?? "body", label: opts.name ?? "inspect", deviceArg: opts.device ?? null, gotoUrl, actions, bools };
};

// Split an action payload into [selector, value] on the FIRST `::` (values may contain
// `::`; a payload with none has a null value).
const splitTarget = (payload) => {
  const i = payload.indexOf("::");
  return i === -1 ? [payload, null] : [payload.slice(0, i), payload.slice(i + 2)];
};

// Run the collected actions in order on `page`. Each targets `locator(sel).first()`, so
// Playwright auto-waits for actionability; a bad/covered/disabled target throws.
const runActions = async (page, list) => {
  for (const { type, payload } of list) {
    const [sel, value] = splitTarget(payload);
    const loc = () => page.locator(sel).first();
    switch (type) {
      case "click": await loc().click(); break;
      case "dblclick": await loc().dblclick(); break;
      case "fill": await loc().fill(value ?? ""); break;
      case "type": await loc().pressSequentially(value ?? ""); break;
      // sel::Key → press on the element; a bare Key → the page keyboard (focused element).
      case "press": value === null ? await page.keyboard.press(sel) : await loc().press(value); break;
      case "select": await loc().selectOption(value); break; // native <select> only
      case "check": await loc().check(); break;
      case "uncheck": await loc().uncheck(); break;
      case "hover": await loc().hover(); break;
      case "scroll": await loc().scrollIntoViewIfNeeded(); break;
      case "upload": await loc().setInputFiles(value); break;
      // --wait <ms> (all-digit) → timeout; --wait <sel> → wait for visible.
      case "wait":
        /^\d+$/.test(sel)
          ? await page.waitForTimeout(Number(sel))
          : await page.waitForSelector(sel, { state: "visible" });
        break;
      default: throw new Error(`unknown action --${type}`);
    }
  }
};

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
  const { selector, label, deviceArg, gotoUrl, actions, bools } = parseArgs();
  const device = resolveDevice(deviceArg);
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context — is shared-browser.mjs running?");
  const pages = context.pages();
  // Prefer the app tab, else the last-opened page.
  const page =
    pages.find((p) => p.url().includes("localhost:3000")) ?? pages[pages.length - 1];
  if (!page) throw new Error("No open page to inspect.");

  // Attach console/network capture BEFORE any action so live interaction logs are caught
  // (a later reload would discard them). Reused for the live path and the no-action
  // reload path below.
  const consoleLogs = [];
  if (bools.console) {
    page.on("console", (m) => consoleLogs.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
    page.on("requestfailed", (r) =>
      consoleLogs.push(`REQFAIL ${r.url()} ${r.failure()?.errorText ?? ""}`));
  }

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

  // Drive interactions (left→right) after navigation + device setup, before we measure,
  // then let the UI settle so the screenshot/metrics reflect the post-action state.
  if (actions.length) {
    await runActions(page, actions);
    await page.waitForTimeout(300);
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

  if (bools.a11y) {
    const res = await new AxeBuilder({ page }).analyze();
    report.a11y = res.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.flatMap((n) => n.target).slice(0, 8),
    }));
  }

  if (bools.console) {
    // Actions already ran with listeners live → keep those logs. No actions → reload to
    // capture a fresh window (today's behavior); the listeners above record it.
    if (!actions.length) await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    report.console = consoleLogs.slice(0, 40);
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
