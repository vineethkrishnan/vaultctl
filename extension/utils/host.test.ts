// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { hostMatches, registrableDomain, domainMatches, isSafeHttpUri } from "./host";

describe("hostMatches", () => {
  it("treats apex and www as equal but keeps other subdomains distinct", () => {
    expect(hostMatches("www.bank.com", "bank.com")).toBe(true);
    expect(hostMatches("accounts.google.com", "mail.google.com")).toBe(false);
  });
});

describe("registrableDomain", () => {
  it("reduces a host to eTLD+1", () => {
    expect(registrableDomain("mail.google.com")).toBe("google.com");
    expect(registrableDomain("www.example.com")).toBe("example.com");
    expect(registrableDomain("example.com")).toBe("example.com");
  });

  it("handles multi-part public suffixes", () => {
    expect(registrableDomain("shop.foo.co.uk")).toBe("foo.co.uk");
    expect(registrableDomain("foo.co.uk")).toBe("foo.co.uk");
    expect(registrableDomain("a.b.com.au")).toBe("b.com.au");
  });

  it("strips ports and leaves IPv4 untouched", () => {
    expect(registrableDomain("mail.google.com:443")).toBe("google.com");
    expect(registrableDomain("192.168.0.1")).toBe("192.168.0.1");
  });

  it("treats multi-tenant hosting platforms as effective TLDs", () => {
    expect(registrableDomain("foo.github.io")).toBe("foo.github.io");
    expect(registrableDomain("bar.github.io")).toBe("bar.github.io");
    expect(registrableDomain("app.vercel.app")).toBe("app.vercel.app");
    expect(registrableDomain("bucket.s3.amazonaws.com")).toBe(
      "bucket.s3.amazonaws.com",
    );
  });
});

describe("domainMatches", () => {
  it("matches across subdomains of the same registrable domain", () => {
    expect(domainMatches("accounts.google.com", "mail.google.com")).toBe(true);
    expect(domainMatches("foo.co.uk", "bar.foo.co.uk")).toBe(true);
  });

  it("does not match across different registrable domains", () => {
    expect(domainMatches("google.com", "google.co.uk")).toBe(false);
    expect(domainMatches("evil.com", "bank.com")).toBe(false);
  });

  it("does not match across tenants of a shared hosting platform", () => {
    expect(domainMatches("alice.github.io", "mallory.github.io")).toBe(false);
    expect(domainMatches("victim.herokuapp.com", "attacker.herokuapp.com")).toBe(
      false,
    );
  });
});

describe("isSafeHttpUri", () => {
  it("accepts http(s) and rejects other schemes", () => {
    expect(isSafeHttpUri("https://example.com")).toBe(true);
    expect(isSafeHttpUri("javascript:alert(1)")).toBe(false);
  });
});
