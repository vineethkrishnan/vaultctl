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

// Trash-specific flows: list -> restore / purge / empty.

test.describe.serial("Trash lifecycle", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
      items: [
        {
          id: "trashed-1",
          vaultId: "vault-1",
          itemType: "login",
          encryptedName: fakeEncrypt("First Trashed"),
          trashed: true,
        },
        {
          id: "trashed-2",
          vaultId: "vault-1",
          itemType: "secure_note",
          encryptedName: fakeEncrypt("Second Trashed"),
          trashed: true,
        },
      ],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  test("lists seeded trashed items", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    await page.getByRole("link", { name: "Trash" }).first().click();
    await expect(page).toHaveURL(/\/trash/);

    await expect(page.getByText("First Trashed")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Second Trashed")).toBeVisible();
  });

  test("restores a single item back to the active list", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });
    await page.getByRole("link", { name: "Trash" }).first().click();
    await expect(page.getByText("First Trashed")).toBeVisible({ timeout: 10_000 });

    const restoreResponse = page.waitForResponse(
      (response) =>
        /\/trash\/trashed-1\/restore$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    );

    // Click the first restore button (two rows, take first)
    await page.getByRole("button", { name: "Restore" }).first().click();
    await restoreResponse;

    // Item disappears from trash view
    await expect(page.getByText("First Trashed")).toBeHidden({ timeout: 10_000 });
    // One trashed item remains
    await expect(page.getByText("Second Trashed")).toBeVisible();
  });

  test("permanently deletes an item via the purge button", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });
    await page.getByRole("link", { name: "Trash" }).first().click();
    await expect(page.getByText("First Trashed")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Delete permanently" }).first().click();

    // Themed confirm dialog replaces the native window.confirm.
    const purgeResponse = page.waitForResponse(
      (response) =>
        /\/trash\/trashed-1$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Delete forever" }).click();
    await purgeResponse;

    await expect(page.getByText("First Trashed")).toBeHidden({ timeout: 10_000 });
  });

  test("empties expired trash after confirming", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });
    await page.getByRole("link", { name: "Trash" }).first().click();
    await expect(page.getByText("First Trashed")).toBeVisible({ timeout: 10_000 });

    const purgeResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/vaults/vault-1/trash" &&
        response.request().method() === "DELETE",
    );

    await page.getByRole("button", { name: "Empty expired" }).click();
    // Destructive actions confirm through ConfirmDialog, never window.confirm.
    await expect(page.getByText(/more than 30 days/)).toBeVisible();
    await page.getByRole("button", { name: "Delete expired" }).click();
    await purgeResponse;

    await expect(page.getByText("Deleted 2 expired items.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("First Trashed")).toBeHidden();
    await expect(page.getByText("Second Trashed")).toBeHidden();
  });

  test("leaves the trash alone when the confirm is dismissed", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });
    await page.getByRole("link", { name: "Trash" }).first().click();
    await expect(page.getByText("First Trashed")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Empty expired" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByText("First Trashed")).toBeVisible();
    expect(state.items.filter((item) => item.trashed)).toHaveLength(2);
  });
});
