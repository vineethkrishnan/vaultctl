// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from "@playwright/test";
import {
  createMockState,
  fakeEncrypt,
  loginViaUI,
  mockApiFull,
  stubCryptoWorker,
  type MockState,
} from "./helpers/mock-api-full";

// Markdown editing for secure-note content/notes, plus the XSS defences that
// matter because this page holds the decrypted vault keys in memory.

function seedNote(state: MockState, data: Record<string, unknown>) {
  state.items.push({
    id: "item-1",
    vaultId: "vault-1",
    folderId: null,
    itemType: "secure_note",
    encryptedData: fakeEncrypt(JSON.stringify(data)),
    encryptedName: fakeEncrypt("Wifi"),
    favorite: false,
    reprompt: false,
    trashed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

test.describe("Markdown notes", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
      items: [],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  async function openNote(page: import("@playwright/test").Page) {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });
    await page.getByRole("link", { name: /Wifi/ }).click();
    await expect(page).toHaveURL(/\/items\/item-1/);
  }

  test("renders markdown in preview", async ({ page }) => {
    seedNote(state, {
      content: "## Router\n\n**SSID:** home-5g\n\n- guest: abc\n- admin: xyz",
      notes: "",
      customFields: [],
    });
    await openNote(page);

    const contentField = page.getByLabel("Content");
    await expect(contentField).toHaveValue(/## Router/, { timeout: 10_000 });

    // Toggle the Content field into preview
    await page
      .locator("div", { has: contentField })
      .last()
      .getByRole("button", { name: "Preview" })
      .click();

    const preview = page.getByTestId("markdown-preview").first();
    await expect(preview.getByRole("heading", { name: "Router" })).toBeVisible();
    await expect(preview.locator("strong")).toHaveText("SSID:");
    await expect(preview.locator("li")).toHaveCount(2);
  });

  test("does not render raw HTML as live elements", async ({ page }) => {
    seedNote(state, {
      content:
        '<img src=x onerror="window.__xss=1">\n\n<script>window.__xss=1</script>\n\n<b>not bold</b>',
      notes: "",
      customFields: [],
    });
    await openNote(page);

    await expect(page.getByLabel("Content")).toHaveValue(/img src=x/, {
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Preview" }).first().click();

    const preview = page.getByTestId("markdown-preview").first();
    await expect(preview).toBeVisible();

    // The HTML must appear as literal text, never as parsed nodes.
    await expect(preview.locator("img")).toHaveCount(0);
    await expect(preview.locator("script")).toHaveCount(0);
    await expect(preview.locator("b")).toHaveCount(0);
    await expect(preview).toContainText("<b>not bold</b>");
    expect(await page.evaluate(() => (window as never as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("neutralises javascript: links and blocks remote images", async ({ page }) => {
    seedNote(state, {
      content:
        "[click me](javascript:window.__xss=1)\n\n![tracker](https://tracker.example/pixel.png)",
      notes: "",
      customFields: [],
    });
    await openNote(page);

    await expect(page.getByLabel("Content")).toHaveValue(/click me/, {
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Preview" }).first().click();

    const preview = page.getByTestId("markdown-preview").first();

    // Link renders, but the javascript: URL must not survive as the href.
    const href = await preview.getByRole("link", { name: "click me" }).getAttribute("href");
    expect(href ?? "").not.toContain("javascript:");

    // Remote images are stripped so a note cannot phone home / leak IP on open.
    await expect(preview.locator("img")).toHaveCount(0);
  });

  test("bold toolbar button wraps the selection", async ({ page }) => {
    seedNote(state, { content: "hello", notes: "", customFields: [] });
    await openNote(page);

    const contentField = page.getByLabel("Content");
    await expect(contentField).toHaveValue("hello", { timeout: 10_000 });

    await contentField.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.getByRole("button", { name: "Bold" }).first().click();

    await expect(contentField).toHaveValue("**hello**");
  });
});
