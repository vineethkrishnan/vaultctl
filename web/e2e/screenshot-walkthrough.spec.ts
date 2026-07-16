// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Screenshot capture for docs/setup/walkthrough.md.
//
// Drives a clean install of vaultctl through the documented first-user flow
// and writes one PNG per step into docs/setup/screenshots/.
//
// Prerequisites:
//   - Stack running and reachable. By default targets `https://localhost`
//     (the docker-compose.yml Caddy stack with internal cert). Override
//     with PLAYWRIGHT_BASE_URL.
//   - Empty users table. The first registration will become owner via the
//     bootstrap bypass, then the script logs in and adds an item.
//
// Run:
//   cd web
//   PLAYWRIGHT_BASE_URL=https://localhost npx playwright test \
//     --config=playwright.screenshots.config.ts

import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "../../docs/setup/screenshots");

const EMAIL = "alice@example.com";
const NAME = "Alice";
const PASSWORD = "Sandbox-Walkthrough-Demo-2026!";

// Let route transitions finish painting. Playwright reports an element visible
// as soon as it has a box, which is before the incoming route has faded in, so
// a shot taken on the assertion alone catches a washed-out panel.
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({
    path: path.join(OUT_DIR, name),
    fullPage: false,
  });
}

test.use({ colorScheme: "light" });

test("capture walkthrough screenshots", async ({ page, context }) => {
  // The app reads `vaultctl_theme` from localStorage on boot and falls back
  // to prefers-color-scheme otherwise. Pin both to light for stable shots.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("vaultctl_theme", "light");
    } catch {}
  });

  // ----------------------------------------------------------- 01. Login
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "vaultctl" })).toBeVisible();
  await shot(page, "01-login.png");

  // ----------------------------------------------------------- 02. Register (empty)
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Create Account" }),
  ).toBeVisible();
  await shot(page, "02-register-empty.png");

  // ----------------------------------------------------------- 03. Register (filled)
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Name").fill(NAME);
  await page.getByLabel("Master Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm Password").fill(PASSWORD);
  await shot(page, "03-register-filled.png");

  // ----------------------------------------------------------- 04. Recovery kit
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page.getByText(/recovery key/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: /Continue to Login/i }),
  ).toBeVisible({ timeout: 30_000 });
  await shot(page, "04-recovery-kit.png");

  // Acknowledge + continue
  await page.locator("#recovery-confirm").check();
  await page.getByRole("button", { name: /Continue to Login/i }).click();

  // ----------------------------------------------------------- 05. Empty vault
  // Log in
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Master Password").fill(PASSWORD);
  await page.getByRole("button", { name: /Unlock/i }).click();

  // Land on vault page. The default vault should be the personal vault.
  await page.waitForURL(/\/vault\//, { timeout: 60_000 });
  // Wait for the empty-state indicator. The vault list is rendered via the
  // worker after key derivation completes, so allow extra time.
  await expect(
    page.getByText(/no items|empty|create your first/i).first(),
  ).toBeVisible({ timeout: 30_000 });
  await shot(page, "05-empty-vault.png");

  // ----------------------------------------------------------- 06. Item type picker
  // Empty-state CTA + sidebar both expose "Create Item" / "New Item" as
  // <Link> elements; both land on the item-type picker.
  await page.getByRole("link", { name: /Create Item/i }).first().click();
  await expect(page.getByText(/Choose an item type/i)).toBeVisible({
    timeout: 10_000,
  });
  // Assert the first and last tile, not just the heading: shot() settles the
  // route transition, but the grid must actually be there to be captured.
  await expect(page.getByRole("button", { name: /^Login$/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: /^GPG Key$/ })).toBeVisible({
    timeout: 10_000,
  });
  await shot(page, "06-new-item-types.png");

  // ----------------------------------------------------------- 07. New item filled
  await page.getByRole("button", { name: /^Login$/ }).first().click();
  // Placeholder-only name input + labelled Login fields.
  await page.getByPlaceholder("Item name").fill("GitHub");
  await page.getByLabel(/Username/i).fill("alice");
  await page.getByLabel(/^Password$/i).fill("hunter2-walkthrough");
  await page.getByLabel(/^URI$/i).fill("https://github.com");
  await shot(page, "07-new-item-filled.png");

  // ----------------------------------------------------------- 08. Vault with item
  await page.getByRole("button", { name: /Create Item/i }).click();
  // Creating persists via the crypto worker + POST, then the app returns to the
  // vault list. Wait for that navigation before asserting: the GitHub row only
  // exists once the in-flight create resolves.
  await page.waitForURL((url) => /\/vault\/[^/]+$/.test(url.pathname), {
    timeout: 20_000,
  });
  await expect(
    page.getByRole("link", { name: /GitHub/i }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await shot(page, "08-vault-with-item.png");
});
