// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 1Password legacy CSV importer.
 *
 * The legacy 1Password CSV exporter writes logins with columns roughly:
 *   Title, Website, Username, Password, OTPAuth, Notes
 *
 * Real-world exports have varied over the years - this parser looks up cells
 * by a case-insensitive header name so reorderings and capitalisation
 * differences don't break it. Rows with no username/password AND a populated
 * Notes column are treated as secure notes.
 */

import { parsedItemArraySchema, type Importer, type ParsedItem } from "./types.js";
import { inputToText, parseCSV } from "./csv.js";

type HeaderLookup = (key: string) => string;

const TITLE_KEYS = ["title", "name"];
const USERNAME_KEYS = ["username", "login username", "email"];
const PASSWORD_KEYS = ["password", "login password"];
const URL_KEYS = ["website", "url", "urls"];
const TOTP_KEYS = ["otpauth", "otp", "totp", "one-time password"];
const NOTES_KEYS = ["notes", "note"];

export async function parse(input: File | string | Uint8Array): Promise<ParsedItem[]> {
  const text = await inputToText(input);
  return parsedItemArraySchema.parse(parseOnePasswordCSV(text));
}

export function parseOnePasswordCSV(csv: string): ParsedItem[] {
  const rows = parseCSV(csv);
  if (rows.length < 2) return [];

  const headerRow = rows[0];
  if (!headerRow) return [];
  const headers = headerRow.map((header) => header.trim().toLowerCase());

  const items: ParsedItem[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const cols = rows[rowIndex];
    if (!cols) continue;

    const lookup: HeaderLookup = (key) => {
      const columnIndex = headers.indexOf(key);
      if (columnIndex < 0) return "";
      return cols[columnIndex] ?? "";
    };

    const pickFirst = (keys: readonly string[]): string => {
      for (const key of keys) {
        const value = lookup(key);
        if (value.length > 0) return value;
      }
      return "";
    };

    const title = pickFirst(TITLE_KEYS);
    const username = pickFirst(USERNAME_KEYS);
    const password = pickFirst(PASSWORD_KEYS);
    const uri = pickFirst(URL_KEYS);
    const totp = pickFirst(TOTP_KEYS);
    const notes = pickFirst(NOTES_KEYS);
    const name = title.length > 0 ? title : "Untitled";

    const hasCredentials = username.length > 0 || password.length > 0 || uri.length > 0;

    if (!hasCredentials && notes.length > 0) {
      items.push({
        name,
        type: "secure_note",
        data: {
          content: notes,
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
        username,
        password,
        uri,
        totp,
        notes,
        customFields: [],
      },
    });
  }

  return items;
}

export const importer: Importer = {
  id: "onepassword-csv",
  label: "1Password (Legacy CSV)",
  accept: ".csv,text/csv",
  parse,
};
