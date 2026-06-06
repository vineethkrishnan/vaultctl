// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { decodeAccessTokenClaims } from "./jwt-claims.js";

function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (input: string) =>
    Buffer.from(input)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe("decodeAccessTokenClaims", () => {
  it("extracts userId (sub) and role from a valid token", () => {
    const token = makeJwt({ sub: "user-123", role: "admin", exp: 9999999999 });
    expect(decodeAccessTokenClaims(token)).toEqual({
      userId: "user-123",
      role: "admin",
    });
  });

  it("defaults role to an empty string when absent", () => {
    const token = makeJwt({ sub: "user-9" });
    expect(decodeAccessTokenClaims(token)).toEqual({ userId: "user-9", role: "" });
  });

  it("returns null when sub is missing", () => {
    const token = makeJwt({ role: "user" });
    expect(decodeAccessTokenClaims(token)).toBeNull();
  });

  it("returns null for a non-JWT string", () => {
    expect(decodeAccessTokenClaims("not-a-token")).toBeNull();
    expect(decodeAccessTokenClaims("a.b")).toBeNull();
  });

  it("returns null when the payload is not valid JSON", () => {
    const header = "x";
    const body = Buffer.from("{not json")
      .toString("base64")
      .replace(/=+$/, "");
    expect(decodeAccessTokenClaims(`${header}.${body}.sig`)).toBeNull();
  });
});
