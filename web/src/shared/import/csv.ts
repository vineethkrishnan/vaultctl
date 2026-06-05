// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared CSV helpers used by multiple importers.
 *
 * Hand-rolled parser matches the original behaviour of the Bitwarden importer
 * that used to live inside ImportDialog.tsx. Handles:
 *   - quoted fields with embedded commas
 *   - doubled quotes as literal quote escapes
 *   - embedded CRLF / LF inside quoted fields
 *   - trailing empty rows
 */

/** Parse an entire CSV document into rows of columns. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const ch = text[index];

    if (ch === '"') {
      if (inQuotes && text[index + 1] === '"') {
        current += '"';
        index++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      currentRow.push(current);
      current = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      // Swallow CRLF as one break.
      if (ch === "\r" && text[index + 1] === "\n") {
        index++;
      }
      currentRow.push(current);
      current = "";
      rows.push(currentRow);
      currentRow = [];
      continue;
    }

    current += ch;
  }

  // Flush trailing field/row if any content pending.
  if (current.length > 0 || currentRow.length > 0) {
    currentRow.push(current);
    rows.push(currentRow);
  }

  // Drop fully-empty trailing rows.
  return rows.filter((row) => row.some((cell) => cell.length > 0));
}

/**
 * Parse a single CSV line into cells. Kept for parity with the original
 * ImportDialog parseCSVRow helper - does NOT handle embedded newlines. Prefer
 * parseCSV for full documents.
 */
export function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const ch = line[index];
    if (ch === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

/** Serialize a single value for CSV output - quotes if required. */
export function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize a row of values into a CSV line (no trailing newline). */
export function csvRowToString(row: readonly string[]): string {
  return row.map(csvEscape).join(",");
}

/**
 * Normalise heterogeneous parser input into a UTF-8 string. Used by the
 * text-based parsers (CSV, XML).
 */
export async function inputToText(input: File | string | Uint8Array): Promise<string> {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof Uint8Array) {
    return new TextDecoder().decode(input);
  }
  return input.text();
}

/** Normalise heterogeneous parser input into raw bytes. Used by 1PUX. */
export async function inputToBytes(input: File | string | Uint8Array): Promise<Uint8Array> {
  if (typeof input === "string") {
    return new TextEncoder().encode(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  return new Uint8Array(await input.arrayBuffer());
}
