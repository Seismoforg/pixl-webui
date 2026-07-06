// Attach to the shared browser (shared-browser.mjs) over CDP, read its ACTIVE page,
// and report: a screenshot (PNG for Claude to Read) + exact element metrics (box model
// + computed styles + spacing + overflow). Flags: --a11y (axe-core violations),
// --console (console + failed requests, captured over a short reload window).
//
// Usage: node e2e/inspect.mjs [selector] [--a11y] [--console] [--name <label>]
// Env:   CDP_PORT (default 9222).

import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const screensDir = resolve(here, "screens");
const cdpPort = process.env.CDP_PORT ?? "9222";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const selector = args.find((a) => !a.startsWith("--")) ?? "body";
const label = opt("name", "inspect");

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
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context — is shared-browser.mjs running?");
  const pages = context.pages();
  // Prefer the app tab, else the last-opened page.
  const page =
    pages.find((p) => p.url().includes("localhost:3000")) ?? pages[pages.length - 1];
  if (!page) throw new Error("No open page to inspect.");

  mkdirSync(screensDir, { recursive: true });
  const shot = resolve(screensDir, `${label}.png`);
  await page.screenshot({ path: shot });

  const report = { url: page.url(), viewport: page.viewportSize(), selector };
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
  await browser.close(); // disconnects CDP only; the user's browser stays open
};

main().catch((err) => {
  console.error(`[inspect] ${err.message}`);
  process.exit(1);
});
