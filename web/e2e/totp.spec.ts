import { test, expect } from "@playwright/test";
import {
  createMockState,
  loginViaUI,
  mockApiFull,
  stubCryptoWorker,
  type MockState,
} from "./helpers/mock-api-full";

// TOTP setup flow via Settings -> Enable 2FA.

test.describe.serial("TOTP setup", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  test("renders QR + secret after Begin Setup", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings/);

    await page.getByRole("button", { name: "Enable 2FA" }).click();

    const setupResponse = page.waitForResponse(
      (response) =>
        /\/api\/v1\/auth\/totp\/setup$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Begin Setup" }).click();
    await setupResponse;

    await expect(page.getByRole("heading", { name: "Scan QR Code" })).toBeVisible();
    // The otpauth URL and the secret both render. getByText would match
    // both because the URL contains the secret — use exact match for the
    // secret so we target only the manual-entry code block.
    await expect(page.getByText("JBSWY3DPEHPK3PXP", { exact: true })).toBeVisible();
  });

  test("verifies a 6-digit code and finishes setup", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Enable 2FA" }).click();
    await page.getByRole("button", { name: "Begin Setup" }).click();
    await expect(page.getByRole("heading", { name: "Scan QR Code" })).toBeVisible();

    // Enter a fake 6-digit code — the mock accepts any value.
    await page.getByLabel("Verification code").fill("123456");

    const enableResponse = page.waitForResponse(
      (response) =>
        /\/api\/v1\/auth\/totp\/enable$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Enable 2FA" }).click();
    await enableResponse;

    // Post-enable the Settings section flips to the "2FA is enabled" label.
    await expect(page.getByText("2FA is enabled")).toBeVisible({ timeout: 10_000 });
  });
});
