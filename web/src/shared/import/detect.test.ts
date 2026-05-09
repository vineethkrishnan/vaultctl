// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { detectFromInput } from "./detect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "__fixtures__");

function read(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("detectFormat", () => {
  it("identifies Bitwarden CSV by header columns", () => {
    expect(
      detectFromInput({ name: "export.csv", sample: read("bitwarden.csv") }),
    ).toBe("bitwarden-csv");
  });

  it("identifies LastPass CSV by header columns", () => {
    expect(
      detectFromInput({ name: "lastpass_export.csv", sample: read("lastpass.csv") }),
    ).toBe("lastpass-csv");
  });

  it("identifies 1Password legacy CSV by title/otpauth header", () => {
    expect(
      detectFromInput({
        name: "1password.csv",
        sample: read("onepassword-legacy.csv"),
      }),
    ).toBe("onepassword-csv");
  });

  it("identifies 1PUX by file extension", () => {
    expect(
      detectFromInput({ name: "export.1pux", sample: "PK\x03\x04binary" }),
    ).toBe("onepassword-1pux");
  });

  it("identifies KeePass XML by extension", () => {
    expect(
      detectFromInput({ name: "keepass.xml", sample: read("keepass.xml") }),
    ).toBe("keepass-xml");
  });

  it("identifies KeePass XML by content sniff when extension is missing", () => {
    expect(
      detectFromInput({ name: "dump", sample: read("keepass.xml") }),
    ).toBe("keepass-xml");
  });

  it("returns null for unknown formats", () => {
    expect(
      detectFromInput({ name: "unknown.dat", sample: "nothing matches" }),
    ).toBeNull();
  });
});
