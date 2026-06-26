// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Firefox password CSV importer.
 *
 * Firefox's about:logins export uses the columns:
 *   url, username, password, httpRealm, formActionOrigin, guid,
 *   timeCreated, timeLastUsed, timePasswordChanged
 *
 * There is no display-name column, so the entry name is derived from the url
 * host. Every row is a login.
 */

import { parsedItemArraySchema, type Importer, type ParsedItem } from "./types.js";
import { inputToText, parseCSV } from "./csv.js";

export async function parse(input: File | string | Uint8Array): Promise<ParsedItem[]> {
  const text = await inputToText(input);
  return parsedItemArraySchema.parse(parseFirefoxCSV(text));
}

export function parseFirefoxCSV(csv: string): ParsedItem[] {
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

    items.push({
      name: hostFromUrl(url),
      type: "login",
      data: {
        username: row["username"] ?? "",
        password: row["password"] ?? "",
        uri: url,
        totp: "",
        notes: "",
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
  id: "firefox-csv",
  label: "Firefox (CSV)",
  accept: ".csv,text/csv",
  parse,
};
