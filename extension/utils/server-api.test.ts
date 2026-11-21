// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./server-api";

const SERVER = "https://vault.example.test/";

function stubFetch(implementation: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function hangUntilAborted(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("returns the parsed body and strips the trailing slash from the server url", async () => {
    const fetchMock = stubFetch(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await expect(api(SERVER, "/api/v1/health")).resolves.toEqual({ status: "ok" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://vault.example.test/api/v1/health");
  });

  it("gives up on a server that never answers and reports a timeout", async () => {
    stubFetch(hangUntilAborted);
    const startedAt = Date.now();

    await expect(api(SERVER, "/api/v1/auth/prelogin", { timeoutMs: 50 })).rejects.toMatchObject({
      code: "TIMEOUT",
      message: expect.stringContaining("did not respond"),
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("times out a response whose body never finishes", async () => {
    stubFetch(async (_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      });
      return new Response(body, { status: 200 });
    });

    await expect(api(SERVER, "/api/v1/health", { timeoutMs: 50 })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("maps a refused connection to a network error", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(api(SERVER, "/api/v1/health")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringContaining("Can't reach the server at https://vault.example.test."),
    });
  });

  it("maps a non-JSON body to a bad response", async () => {
    stubFetch(async () => new Response("<html></html>", { status: 200 }));

    await expect(api(SERVER, "/api/v1/health")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("surfaces the server's error code and message", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: { code: "INVALID_CREDENTIALS", message: "Wrong password" } }), {
          status: 401,
        }),
    );

    await expect(api(SERVER, "/api/v1/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Wrong password",
    });
  });
});
