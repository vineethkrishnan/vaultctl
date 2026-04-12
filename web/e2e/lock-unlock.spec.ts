import { test, expect } from "@playwright/test";
import {
  createMockState,
  loginViaUI,
  mockApiFull,
  stubCryptoWorker,
  type MockState,
} from "./helpers/mock-api-full";

// Lock / unlock flow.
//
// The v1 lock button calls lockKeys() then sets isLocked in the auth store.
// The router's authLayout beforeLoad redirects to /lock on next navigation.
// Once on /lock the unlock form currently terminates the session and forces
// a re-login (per LockPage comment: "Phase 3 Worker will support true
// unlock"). We verify the observable UI transitions, not real key material.

test.describe.serial("Lock / unlock", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  test("clicking Lock Vault navigates to the lock screen on next route", async ({
    page,
  }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    // Click the lock button in the sidebar footer.
    await page.getByRole("button", { name: "Lock Vault" }).click();

    // The auth store flips isLocked=true. Trigger a navigation so the
    // router re-evaluates beforeLoad and redirects to /lock.
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/lock/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Vault Locked" })).toBeVisible();
  });

  test("unlock form submits password and routes back to login", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    // Navigate directly to /lock — the v1 lock is effectively re-login.
    await page.goto("/lock");
    await expect(page.getByRole("heading", { name: "Vault Locked" })).toBeVisible();

    await page.getByLabel("Master Password").fill("test-master-password-123");
    await page.getByRole("button", { name: "Unlock" }).click();

    // v1 behavior: unlock triggers logout + redirect to /login.
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("lock screen supports immediate logout", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    await page.goto("/lock");
    await page.getByText("Log out instead").click();
    await expect(page).toHaveURL(/\/login/);
  });
});
