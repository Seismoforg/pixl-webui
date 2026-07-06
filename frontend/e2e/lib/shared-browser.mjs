// Launch a shared, headed Chromium the USER drives, exposing a CDP endpoint so a
// separate `inspect.mjs` process can attach and read the active page. Points at the
// real running app (start.bat). Stays alive until the window is closed.
//
// Env: APP_URL (default http://localhost:3000), CDP_PORT (default 9222),
//      HEADLESS=1 (default headed; set for a windowless run / CI check).

import { chromium } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const profileDir = resolve(here, "..", ".profile");
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const cdpPort = process.env.CDP_PORT ?? "9222";

const main = async () => {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: process.env.HEADLESS === "1",
    viewport: null, // follow the real window size
    args: [`--remote-debugging-port=${cdpPort}`],
  });

  const page = context.pages()[0] ?? (await context.newPage());
  // Best-effort: the app may not be up yet; the user can navigate manually.
  await page.goto(appUrl, { waitUntil: "domcontentloaded" }).catch(() => {
    console.log(`[shared-browser] could not reach ${appUrl} yet — is start.bat running?`);
  });

  console.log(`[shared-browser] driving ${appUrl}; CDP on http://localhost:${cdpPort}`);
  console.log("[shared-browser] prepare any state, then ask Claude to inspect. Close the window to stop.");

  await new Promise((done) => {
    context.on("close", done);
    process.on("SIGINT", done);
  });
  await context.close().catch(() => {});
  process.exit(0);
};

main();
