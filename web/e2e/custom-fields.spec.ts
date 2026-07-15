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

// Custom field values must survive multi-line input: an <input> silently strips
// newlines, which corrupted pasted keys/codes.

const MULTILINE = "line one\nline two\nline three";

test.describe("Custom fields", () => {
  let state: MockState;

  function seed(fields: unknown[]) {
    state.items.push({
      id: "item-1",
      vaultId: "vault-1",
      folderId: null,
      itemType: "secure_note",
      encryptedData: fakeEncrypt(
        JSON.stringify({ content: "", notes: "", customFields: fields }),
      ),
      encryptedName: fakeEncrypt("Notes"),
      favorite: false,
      reprompt: false,
      trashed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
      items: [],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  async function open(page: import("@playwright/test").Page) {
    await loginViaUI(page);
    await page.getByRole("link", { name: /Notes/ }).click();
    await expect(page.getByPlaceholder("Item name")).toHaveValue("Notes", {
      timeout: 10_000,
    });
  }

  test("text field keeps newlines instead of stripping them", async ({ page }) => {
    seed([{ name: "Codes", value: "", type: "text" }]);
    await open(page);

    const value = page.getByPlaceholder("Value");
    await value.fill(MULTILINE);
    await expect(value).toHaveValue(MULTILINE);
  });

  test("hidden field is masked, revealable, and keeps newlines", async ({ page }) => {
    seed([{ name: "Key", value: MULTILINE, type: "hidden" }]);
    await open(page);

    const value = page.getByPlaceholder("Value");
    await expect(value).toHaveValue(MULTILINE);
    // Masked until revealed, but the underlying value is intact either way.
    await expect(value).toHaveClass(/text-security/);
    await page.getByTitle("Reveal").first().click();
    await expect(value).not.toHaveClass(/text-security/);
    await expect(value).toHaveValue(MULTILINE);
  });

  test("markdown field renders a preview", async ({ page }) => {
    seed([{ name: "Runbook", value: "## Steps\n\n- restart", type: "markdown" }]);
    await open(page);

    await page.getByRole("button", { name: "Preview" }).last().click();
    const preview = page.getByTestId("markdown-preview").last();
    await expect(preview.getByRole("heading", { name: "Steps" })).toBeVisible();
    await expect(preview.locator("li")).toHaveText(["restart"]);
  });
});
