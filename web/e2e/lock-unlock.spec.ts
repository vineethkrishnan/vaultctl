// SPDX-License-Identifier: AGPL-3.0-or-later

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

    // Click the lock button in the sidebar footer's quick-actions row.
    await page.getByRole("button", { name: "Lock vault" }).click();

    // The auth store flips isLocked=true. Trigger an in-app navigation (a full
    // reload would drop the in-memory auth and land on /login instead) so the
    // router re-evaluates beforeLoad and redirects to /lock.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/lock/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Session Locked" })).toBeVisible();
  });

  test("lock screen 'sign in again' routes back to login", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    // The v1 lock is honest re-login: a single action signs out and returns
    // to /login (no in-place unlock yet).
    await page.goto("/lock");
    await expect(page.getByRole("heading", { name: "Session Locked" })).toBeVisible();

    await page.getByRole("button", { name: "Sign in again" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
