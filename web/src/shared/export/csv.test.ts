// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { itemsToCsv, type CsvExportItem } from "./csv.js";

function item(overrides: Partial<CsvExportItem>): CsvExportItem {
  return {
    name: "",
    username: "",
    password: "",
    uri: "",
    notes: "",
    folder: "",
    type: "login",
    ...overrides,
  };
}

describe("itemsToCsv", () => {
  it("writes a header row and one row per item", () => {
    const csv = itemsToCsv([
      item({ name: "GitHub", username: "alice", password: "pw", uri: "https://github.com" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("name,username,password,uri,notes,folder,type");
    expect(lines[1]).toBe("GitHub,alice,pw,https://github.com,,,login");
  });

  it("quotes values containing commas, quotes and newlines", () => {
    const csv = itemsToCsv([
      item({ name: 'Acme, Inc', notes: 'line1\nline2', password: 'a"b' }),
    ]);
    const row = csv.split("\r\n")[1]!;
    expect(row).toContain('"Acme, Inc"');
    expect(row).toContain('"line1\nline2"');
    expect(row).toContain('"a""b"');
  });

  it("emits only the header for an empty list", () => {
    expect(itemsToCsv([])).toBe("name,username,password,uri,notes,folder,type");
  });
});
