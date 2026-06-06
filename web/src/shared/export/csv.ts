// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Plain-CSV export of already-decrypted vault items, for portability to other
 * password managers. The columns mirror the common Bitwarden-style layout so a
 * round-trip through our own CSV importer (and most others) just works.
 *
 * This is pure formatting over plaintext that the caller has decrypted in the
 * browser; it performs no crypto and no network access of its own.
 */

import { csvRowToString } from "../import/csv.js";

export interface CsvExportItem {
  name: string;
  username: string;
  password: string;
  uri: string;
  notes: string;
  folder: string;
  type: string;
}

export const CSV_COLUMNS = [
  "name",
  "username",
  "password",
  "uri",
  "notes",
  "folder",
  "type",
] as const;

/** Build a CSV document (with header row) from decrypted items. */
export function itemsToCsv(items: readonly CsvExportItem[]): string {
  const lines = [csvRowToString(CSV_COLUMNS)];
  for (const item of items) {
    lines.push(
      csvRowToString([
        item.name,
        item.username,
        item.password,
        item.uri,
        item.notes,
        item.folder,
        item.type,
      ]),
    );
  }
  return lines.join("\r\n");
}
