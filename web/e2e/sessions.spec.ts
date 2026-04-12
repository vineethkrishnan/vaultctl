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
// UI GAP: SessionsPanel does not yet exist in the current web client
// (no component, no Settings section, no revoke UI). We verify the route
// mock contract directly so the REST surface is still exercised. When
// the panel lands, add click-through assertions here.

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

  // TODO: SessionsPanel UI does not exist yet. When it ships, replace
  // these direct fetches with: navigate to Settings -> Sessions, click
  // Revoke on a row, assert the DELETE fires and the row disappears.
  test.skip("end-to-end revoke via UI (no UI yet)", async () => {
    // Placeholder — remove when SessionsPanel ships.
  });
});
