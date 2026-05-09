// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "./keepass-xml.js";
import { parsedItemArraySchema } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "__fixtures__/keepass.xml"), "utf8");

describe("keepass-xml", () => {
  it("walks nested groups and yields three entries", async () => {
    const items = await parse(FIXTURE);
    expect(items).toHaveLength(3);
  });

  it("maps credential entries to login and credential-less to secure note", async () => {
    const items = await parse(FIXTURE);
    expect(items.map((item) => item.type)).toEqual([
      "login",
      "login",
      "secure_note",
    ]);
  });

  it("decodes the first entry with decoded entities", async () => {
    const items = await parse(FIXTURE);
    const github = items[0];
    expect(github).toBeDefined();
    if (!github) return;
    expect(github.name).toBe("GitHub");
    expect(github.data).toMatchObject({
      username: "octocat",
      password: "hunter2",
      uri: "https://github.com",
    });
    expect(github.data["notes"]).toBe("Work GitHub with & without 2FA");
  });

  it("collects non-core String entries as customFields", async () => {
    const items = await parse(FIXTURE);
    const github = items[0];
    expect(github).toBeDefined();
    if (!github) return;
    const customFields = github.data["customFields"];
    expect(customFields).toEqual([
      { name: "SecretQuestion", value: "First pet", type: "text" },
    ]);
  });

  it("reads CDATA-wrapped notes into a secure note content", async () => {
    const items = await parse(FIXTURE);
    const wifi = items[2];
    expect(wifi).toBeDefined();
    if (!wifi) return;
    expect(wifi.type).toBe("secure_note");
    expect(wifi.name).toBe("Wifi Password");
    expect(wifi.data["content"]).toContain("SSID: HomeNet");
    expect(wifi.data["content"]).toContain("correct horse battery staple");
  });

  it("passes zod validation", async () => {
    const items = await parse(FIXTURE);
    expect(() => parsedItemArraySchema.parse(items)).not.toThrow();
  });
});
