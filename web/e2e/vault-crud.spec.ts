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

// Core item lifecycle: create -> view -> edit -> trash -> restore.

test.describe.serial("Vault CRUD lifecycle", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
      items: [],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  test("empty state renders after login", async ({ page }) => {
    await loginViaUI(page);

    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "All Items" })).toBeVisible();
    await expect(page.getByText("No items yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create Item" })).toBeVisible();
  });

  test("creates a login item and lists it", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    // Navigate to new-item page via sidebar. Both the sidebar and the items
    // header expose a "New Item" link (added in #100); target the first.
    await page.getByRole("link", { name: "New Item" }).first().click();
    await expect(page).toHaveURL(/\/vault\/vault-1\/items\/new/);

    // Type picker
    await page.getByRole("button", { name: "Login" }).click();

    // Fill the name (ItemEditor header input is a textbox with placeholder "Item name")
    await page.getByPlaceholder("Item name").fill("GitHub");

    const itemCreated = page.waitForResponse(
      (response) =>
        /\/api\/v1\/vaults\/vault-1\/items$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "Create Item" }).click();
    const response = await itemCreated;
    expect(response.status()).toBe(201);

    // After creation we navigate to detail - verify via the header input value.
    await expect(page).toHaveURL(/\/vault\/vault-1\/items\/item-/, { timeout: 10_000 });
    await expect(page.getByPlaceholder("Item name")).toHaveValue("GitHub");
  });

  test("edits an existing item name and saves", async ({ page }) => {
    // Seed state with one item so we land on a stable detail route.
    state.items.push({
      id: "item-1",
      vaultId: "vault-1",
      folderId: null,
      itemType: "login",
      encryptedData: fakeEncrypt("{}"),
      encryptedName: fakeEncrypt("Old Name"),
      favorite: false,
      reprompt: false,
      trashed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    // Click the seeded item in the list
    await page.getByRole("link", { name: /Old Name/ }).click();
    await expect(page).toHaveURL(/\/items\/item-1/);

    // Wait for decryption to resolve the header input
    await expect(page.getByPlaceholder("Item name")).toHaveValue("Old Name", {
      timeout: 10_000,
    });

    // Edit and save
    await page.getByPlaceholder("Item name").fill("New Name");

    const updateResponse = page.waitForResponse(
      (response) =>
        /\/api\/v1\/vaults\/vault-1\/items\/item-1$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save" }).click();
    const response = await updateResponse;
    expect(response.status()).toBe(200);

    // Saving returns to the vault list with the updated name.
    await expect(page).toHaveURL(/\/vault\/vault-1$/, { timeout: 10_000 });
    await expect(page.getByRole("link", { name: /New Name/ })).toBeVisible();
  });

  test("moves an item to trash and then restores it", async ({ page }) => {
    state.items.push({
      id: "item-1",
      vaultId: "vault-1",
      folderId: null,
      itemType: "login",
      encryptedData: fakeEncrypt("{}"),
      encryptedName: fakeEncrypt("Soon Trashed"),
      favorite: false,
      reprompt: false,
      trashed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });
    await page.getByRole("link", { name: /Soon Trashed/ }).click();
    await expect(page.getByPlaceholder("Item name")).toHaveValue("Soon Trashed", {
      timeout: 10_000,
    });

    const trashResponse = page.waitForResponse(
      (response) =>
        /\/api\/v1\/vaults\/vault-1\/items\/item-1$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Move to trash" }).click();
    await trashResponse;

    await expect(page).toHaveURL(/\/vault\/vault-1$/, { timeout: 10_000 });
    await expect(page.getByText("No items yet")).toBeVisible();

    // Navigate to trash and restore
    await page.getByRole("link", { name: "Trash" }).first().click();
    await expect(page).toHaveURL(/\/trash/);
    await expect(page.getByText("Soon Trashed")).toBeVisible({ timeout: 10_000 });

    const restoreResponse = page.waitForResponse(
      (response) =>
        /\/trash\/item-1\/restore$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Restore" }).click();
    await restoreResponse;

    // Trash is now empty
    await expect(page.getByText("Trash is empty")).toBeVisible({ timeout: 10_000 });
  });
});
