// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * LastPass CSV importer.
 *
 * LastPass exports rows with the columns:
 *   url, username, password, totp, extra, name, grouping, fav
 *
 * Secure notes have url="http://sn" and the note body in the extra column.
 * Everything else is treated as a login.
 */

import { parsedItemArraySchema, type Importer, type ParsedItem } from "./types.js";
import { inputToText, parseCSV } from "./csv.js";

const SECURE_NOTE_SENTINEL = "http://sn";

export async function parse(input: File | string | Uint8Array): Promise<ParsedItem[]> {
  const text = await inputToText(input);
  return parsedItemArraySchema.parse(parseLastPassCSV(text));
}

export function parseLastPassCSV(csv: string): ParsedItem[] {
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
    const name = row["name"] && row["name"].length > 0 ? row["name"] : "Untitled";

    if (url === SECURE_NOTE_SENTINEL) {
      items.push({
        name,
        type: "secure_note",
        data: {
          content: row["extra"] ?? "",
          notes: "",
          customFields: [],
        },
      });
      continue;
    }

    items.push({
      name,
      type: "login",
      data: {
        username: row["username"] ?? "",
        password: row["password"] ?? "",
        uri: url,
        totp: row["totp"] ?? "",
        notes: row["extra"] ?? "",
        customFields: [],
      },
    });
  }

  return items;
}

export const importer: Importer = {
  id: "lastpass-csv",
  label: "LastPass (CSV)",
  accept: ".csv,text/csv",
  parse,
};
