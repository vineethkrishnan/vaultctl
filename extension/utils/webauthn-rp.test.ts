// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { defaultRpId, isRpIdAllowed } from "./webauthn-rp";

describe("isRpIdAllowed", () => {
  it("accepts the exact effective domain", () => {
    expect(isRpIdAllowed("webauthn.io", "https://webauthn.io/login")).toBe(true);
    expect(isRpIdAllowed("WebAuthn.IO", "https://webauthn.io/")).toBe(true);
  });

  it("accepts a registrable suffix of the origin", () => {
    expect(isRpIdAllowed("example.com", "https://login.example.com/")).toBe(true);
    expect(isRpIdAllowed("example.com", "https://a.b.example.com/")).toBe(true);
  });

  it("rejects a domain the origin does not own", () => {
    expect(isRpIdAllowed("google.com", "https://evil.com/")).toBe(false);
    expect(isRpIdAllowed("example.com", "https://notexample.com/")).toBe(false);
    expect(isRpIdAllowed("example.com", "https://example.com.evil.com/")).toBe(
      false,
    );
  });

  it("rejects a suffix that is broader than the origin", () => {
    expect(isRpIdAllowed("login.example.com", "https://example.com/")).toBe(
      false,
    );
  });

  it("does not treat www as interchangeable, unlike the fill matcher", () => {
    expect(isRpIdAllowed("example.com", "https://www.example.com/")).toBe(true);
    expect(isRpIdAllowed("www.example.com", "https://example.com/")).toBe(false);
  });

  it("rejects a bare public suffix so one page cannot claim every site under it", () => {
    expect(isRpIdAllowed("com", "https://example.com/")).toBe(false);
    expect(isRpIdAllowed("co.uk", "https://shop.co.uk/")).toBe(false);
    expect(isRpIdAllowed("github.io", "https://alice.github.io/")).toBe(false);
  });

  it("still allows a tenant on a multi-tenant suffix to own its own name", () => {
    expect(isRpIdAllowed("alice.github.io", "https://alice.github.io/")).toBe(
      true,
    );
    expect(isRpIdAllowed("alice.github.io", "https://bob.github.io/")).toBe(
      false,
    );
  });

  it("rejects IP literals, which are never valid rpIds", () => {
    expect(isRpIdAllowed("192.168.1.10", "https://192.168.1.10/")).toBe(false);
    expect(isRpIdAllowed("[::1]", "https://[::1]/")).toBe(false);
  });

  it("allows localhost for local development", () => {
    expect(isRpIdAllowed("localhost", "http://localhost:5173/")).toBe(true);
  });

  it("ignores the port on the origin", () => {
    expect(isRpIdAllowed("example.com", "https://example.com:8443/")).toBe(true);
  });

  it("rejects malformed or empty input", () => {
    expect(isRpIdAllowed("", "https://example.com/")).toBe(false);
    expect(isRpIdAllowed("example.com", "")).toBe(false);
    expect(isRpIdAllowed("https://example.com", "https://example.com/")).toBe(
      false,
    );
  });
});

describe("defaultRpId", () => {
  it("falls back to the origin's hostname without the port", () => {
    expect(defaultRpId("https://login.example.com:8443/x")).toBe(
      "login.example.com",
    );
  });
});
