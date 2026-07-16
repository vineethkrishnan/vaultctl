// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Screenshot-only Playwright config. Points at a running self-host stack
// (see docs/setup/walkthrough.md). The base URL is overridable so the same
// spec can drive a VM-forwarded Caddy on https://localhost, a dev vite
// server, or any production deployment under test.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: /screenshot-walkthrough\.spec\.ts/,
  timeout: 180_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://localhost",
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    // Match the docs/setup baseline (light mode). Headless chromium
    // otherwise picks up `prefers-color-scheme: dark` and the app's
    // theme variables flip every screenshot.
    colorScheme: "light",
    // Entrance animations are still mid-fade when an element first reports
    // visible, so a shot taken then catches a half-transparent panel. The app
    // collapses its animations under prefers-reduced-motion (see app.css), so
    // ask for it rather than sleeping and hoping.
    reducedMotion: "reduce",
    screenshot: "off",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
