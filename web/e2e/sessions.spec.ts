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

// SessionsPanel flows.
//
// The first block verifies the mock route contract directly. The second
// block drives the actual SessionsPanel UI on the Settings page.

test.describe.serial("Sessions — API contract", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      sessions: [
        { id: "sess-current", deviceName: "This Browser", current: true },
        { id: "sess-other-1", deviceName: "iPhone" },
        { id: "sess-other-2", deviceName: "Work Laptop" },
      ],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
    await page.goto("/login");
  });

  test("lists seeded sessions", async ({ page }) => {
    const response = await pageFetch(page, "/api/v1/users/me/sessions");
    expect(response.status).toBe(200);
    const sessions = response.body as Array<{ id: string; current: boolean }>;
    expect(sessions).toHaveLength(3);
    expect(sessions.find((session) => session.current)?.id).toBe("sess-current");
  });

  test("revokes a non-current session", async ({ page }) => {
    const deleteResponse = await pageFetch(
      page,
      "/api/v1/users/me/sessions/sess-other-1",
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);

    const listResponse = await pageFetch(page, "/api/v1/users/me/sessions");
    const sessions = listResponse.body as Array<{ id: string }>;
    expect(sessions.map((session) => session.id)).not.toContain("sess-other-1");
    expect(sessions).toHaveLength(2);
  });

  test("revoking the current session clears it", async ({ page }) => {
    const deleteResponse = await pageFetch(
      page,
      "/api/v1/users/me/sessions/sess-current",
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);

    const listResponse = await pageFetch(page, "/api/v1/users/me/sessions");
    const sessions = listResponse.body as Array<{ id: string }>;
    expect(sessions.map((session) => session.id)).not.toContain("sess-current");
  });
});

test.describe.serial("Sessions — UI", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
      sessions: [
        // Use "test-session-id" for the current session — matches
        // the sessionStorage value seeded by the mock auth flow.
        { id: "test-session-id", deviceName: "This Browser", current: true },
        { id: "sess-phone", deviceName: "iPhone" },
        { id: "sess-laptop", deviceName: "Work Laptop" },
      ],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  test("SessionsPanel renders sessions and revokes non-current via UI", async ({
    page,
  }) => {
    // Login and navigate to settings
    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Master Password").fill("test-master-password-123");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings/);

    // SessionsPanel should render all three sessions
    await expect(page.getByText("Active sessions")).toBeVisible();
    await expect(page.getByText("This Browser")).toBeVisible();
    await expect(page.getByText("iPhone")).toBeVisible();
    await expect(page.getByText("Work Laptop")).toBeVisible();

    // Current session shows "This device" badge
    await expect(page.getByText("This device")).toBeVisible();

    // Track DELETE calls
    const deletePaths: string[] = [];
    page.on("requestfinished", (request) => {
      if (request.method() === "DELETE") {
        deletePaths.push(new URL(request.url()).pathname);
      }
    });

    // Revoke the "iPhone" session (non-current) via its row's button
    const iphoneRow = page.locator("li", { hasText: "iPhone" });
    await iphoneRow.getByRole("button").click();

    // iPhone row should disappear after revoke
    await expect(page.getByText("iPhone")).not.toBeVisible({ timeout: 5_000 });
    expect(deletePaths).toContain("/api/v1/users/me/sessions/sess-phone");

    // "This Browser" and "Work Laptop" should still be visible
    await expect(page.getByText("This Browser")).toBeVisible();
    await expect(page.getByText("Work Laptop")).toBeVisible();
  });
});
