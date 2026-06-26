// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Chrome / Chromium password CSV importer.
 *
 * Chrome's password manager export (chrome://password-manager/passwords) uses
 * the columns:
 *   name, url, username, password, note
 *
 * Older builds omit the trailing note column. Edge, Brave, and other Chromium
 * browsers share this exact shape. Every row is a login.
 */

import { parsedItemArraySchema, type Importer, type ParsedItem } from "./types.js";
import { inputToText, parseCSV } from "./csv.js";

export async function parse(input: File | string | Uint8Array): Promise<ParsedItem[]> {
  const text = await inputToText(input);
  return parsedItemArraySchema.parse(parseChromeCSV(text));
}

export function parseChromeCSV(csv: string): ParsedItem[] {
  const rows = parseCSV(csv);
  if (rows.length < 2) return [];

  const headerRow = rows[0];
  if (!headerRow) return [];
  const headers = headerRow.map((header) => header.trim().toLowerCase());

  const items: ParsedItem[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const cols = rows[rowIndex];
    if (!cols) continue;

    const row: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      row[header] = cols[columnIndex] ?? "";
    });

    const url = row["url"] ?? "";
    const name = row["name"] && row["name"].length > 0 ? row["name"] : hostFromUrl(url);

    items.push({
      name,
      type: "login",
      data: {
        username: row["username"] ?? "",
        password: row["password"] ?? "",
        uri: url,
        totp: "",
        notes: row["note"] ?? "",
        customFields: [],
      },
    });
  }

  return items;
}

function hostFromUrl(url: string): string {
  if (!url) return "Untitled";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export const importer: Importer = {
  id: "chrome-csv",
  label: "Chrome / Edge (CSV)",
  accept: ".csv,text/csv",
  parse,
};
