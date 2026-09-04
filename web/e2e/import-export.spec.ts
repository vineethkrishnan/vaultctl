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
// All three panels live inline in the Settings "Data" tab (they are sections,
// not modals) and are driven through the UI below. The one gap left is a
// successful restore: RestoreDialog runs a real Ed25519 verification against
// the identity key in sessionStorage, which the stubbed crypto worker cannot
// produce a valid signature for. The rejection path is covered instead, and
// the import route contract is pinned separately.

const BITWARDEN_CSV = [
  "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp",
  ',,login,GitHub,,,0,https://github.com,octocat,p@ss,',
  ',,login,GitLab,,,0,https://gitlab.com,octocat,p@ss,',
  ',,note,Meeting Notes,some secret note,,0,,,,',
].join("\n");

async function openDataSettings(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Master Password").fill("test-master-password-123");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings/);
  await page.getByRole("button", { name: "Data" }).click();
}

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

    // Open the profile menu (sidebar footer) and go to Settings. In-app
    // navigation is required - a full reload would drop the in-memory auth.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
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

  test("downloads a signed backup from the export panel", async ({ page }) => {
    await openDataSettings(page);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download encrypted backup" }).click();

    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/^vaultctl-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 10_000 });
    expect(state.exportCalls).toBe(1);
  });

  test("restore panel refuses a tampered backup before any network call", async ({
    page,
  }) => {
    await openDataSettings(page);

    // Structurally complete and addressed to this account, so verification
    // gets all the way to the Ed25519 check and fails there.
    const tampered = JSON.stringify({
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      userId: "test-user-id",
      vaults: [],
      items: [],
      folders: [],
      envelopeMac: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    });

    await page
      .locator('input[type="file"]')
      .last()
      .setInputFiles({
        name: "tampered-backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(tampered, "utf-8"),
      });

    await expect(
      page.getByText(/Signature verification failed/),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Signature verified")).toBeHidden();
    // Refusing before the network is the whole point of the check.
    expect(state.importCalls).toBe(0);
  });

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
