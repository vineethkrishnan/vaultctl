// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { credentialMatchesQuery, filterCredentials } from "./credential-filter";

const creds = [
  { username: "way2vinee@gmail.com", name: "Gmail" },
  { username: "vineeth@loy.info", name: "Vineeth Krishnan" },
  { username: "", name: "Vineeth N K" },
];

describe("credentialMatchesQuery", () => {
  it("matches everything on an empty or whitespace query", () => {
    for (const c of creds) {
      expect(credentialMatchesQuery(c, "")).toBe(true);
      expect(credentialMatchesQuery(c, "   ")).toBe(true);
    }
  });

  it("matches a substring of the username, not just a prefix", () => {
    const gmail = creds[0]!;
    expect(credentialMatchesQuery(gmail, "way2")).toBe(true);
    expect(credentialMatchesQuery(gmail, "gmail")).toBe(true);
    expect(credentialMatchesQuery(creds[1]!, "gmail")).toBe(false);
  });

  it("matches against the item name when the username does not", () => {
    // "kris" appears only in the name "Vineeth Krishnan".
    expect(credentialMatchesQuery(creds[1]!, "kris")).toBe(true);
  });

  it("is case-insensitive on both sides", () => {
    expect(credentialMatchesQuery(creds[0]!, "GMAIL")).toBe(true);
    expect(credentialMatchesQuery({ name: "PayPal" }, "paypal")).toBe(true);
  });

  it("tolerates missing username or name", () => {
    expect(credentialMatchesQuery({ name: "Vineeth N K" }, "n k")).toBe(true);
    expect(credentialMatchesQuery({ username: "a@b.co" }, "b.co")).toBe(true);
    expect(credentialMatchesQuery({}, "anything")).toBe(false);
  });
});

describe("filterCredentials", () => {
  it("returns all entries for an empty query", () => {
    expect(filterCredentials(creds, "")).toHaveLength(3);
  });

  it("narrows to the single matching entry", () => {
    expect(filterCredentials(creds, "way2")).toEqual([creds[0]]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterCredentials(creds, "no-such-thing")).toEqual([]);
  });
});
