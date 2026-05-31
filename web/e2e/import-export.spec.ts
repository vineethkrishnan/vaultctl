// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect, type Page } from "@playwright/test";
import {
  createMockState,
  mockApiFull,
  stubCryptoWorker,
  type MockState,
} from "./helpers/mock-api-full";

async function pageFetch(
  page: Page,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ url, init }) => {
      const response = await fetch(url, init);
      const text = await response.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: response.status, body };
    },
    { url, init },
  );
}

// Import / Export / Restore flows.
//
// NOTE: ExportDialog and RestoreDialog do not exist in the current UI.
// Only ImportDialog exists, and it is embedded directly in the Settings
// route — not a modal. We drive the visible import flow end-to-end and
// verify that a POST per item fires through the mocked backend. For
// export / restore we verify the API route contract only until the UI
// components land. Documented as a UI gap.

const BITWARDEN_CSV = [
  "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp",
  ',,login,GitHub,,,0,https://github.com,octocat,p@ss,',
  ',,login,GitLab,,,0,https://gitlab.com,octocat,p@ss,',
  ',,note,Meeting Notes,some secret note,,0,,,,',
].join("\n");

test.describe.serial("Import / Export / Restore", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  test("imports a Bitwarden CSV from settings and fires one POST per item", async ({
    page,
  }) => {
    // Seed auth by visiting login, filling it, and letting the mocked
    // backend complete login.
    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Master Password").fill("test-master-password-123");
    await page.getByRole("button", { name: "Unlock" }).click();

    // Wait for first vault landing
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    // Go to settings via the sidebar
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings/);
    await page.getByRole("button", { name: "Data" }).click();

    // Select target vault from the picker (shown on /settings since
    // there is no vaultId in the URL params).
    await page.locator("#import-vault").selectOption("vault-1");

    // Upload CSV via the hidden file input.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "bitwarden-export.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(BITWARDEN_CSV, "utf-8"),
    });

    // Dialog displays the parsed item count
    await expect(page.getByText(/3\s*items found/)).toBeVisible({ timeout: 5_000 });

    // Click Import All and wait for the backend POSTs.
    const itemPosts: string[] = [];
    page.on("requestfinished", (request) => {
      const url = new URL(request.url()).pathname;
      if (url === "/api/v1/vaults/vault-1/items" && request.method() === "POST") {
        itemPosts.push(url);
      }
    });

    await page.getByRole("button", { name: "Import All" }).click();

    // Wait for the "Import More" button which appears after success.
    await expect(page.getByRole("button", { name: "Import More" })).toBeVisible({
      timeout: 15_000,
    });

    // Three POSTs should have been observed (one per CSV row).
    expect(itemPosts.length).toBe(3);
  });

  // TODO: ExportDialog component does not yet exist. Verify the mock contract
  // for POST /api/v1/export instead of clicking through a dialog.
  test("export API contract returns a signed bundle", async ({ page }) => {
    await page.goto("/login");

    const response = await pageFetch(page, "/api/v1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultId: "vault-1" }),
    });
    expect(response.status).toBe(200);
    const body = response.body as { version: number; signature: string };
    expect(body.version).toBe(1);
    expect(body.signature).toBeTruthy();
    expect(state.exportCalls).toBe(1);
  });

  // TODO: RestoreDialog component does not yet exist. Round-trip
  // export -> import is blocked on the UI landing. Verify the API
  // contract for POST /api/v1/import separately.
  test("import API contract accepts a bundle and returns a count", async ({
    page,
  }) => {
    await page.goto("/login");

    const response = await pageFetch(page, "/api/v1/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, items: [], signature: "AAAA" }),
    });
    expect(response.status).toBe(200);
    expect(state.importCalls).toBe(1);
  });
});
