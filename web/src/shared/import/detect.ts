// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Auto-detection heuristics for uploaded import files.
 *
 * Order of checks:
 *   1. Filename extension (strongest signal)
 *   2. MIME type
 *   3. First-bytes / first-line sniff for CSVs we can disambiguate
 */

import type { ImportFormat } from "./types.js";

/**
 * Sniff a format from the file metadata and first line of content.
 *
 * Accepts either a File (browser DOM) or a plain shape { name, type, text }
 * so tests can exercise the logic without constructing real File objects.
 */
export interface DetectInput {
  name: string;
  type?: string;
  /** First 4KB of the file decoded as text — parsers use this to sniff CSV headers. */
  sample: string;
}

export async function detectFormat(file: File | DetectInput): Promise<ImportFormat | null> {
  const input = await toDetectInput(file);
  return detectFromInput(input);
}

export function detectFromInput(input: DetectInput): ImportFormat | null {
  const name = input.name.toLowerCase();

  // ZIP-ish extensions map straight to 1PUX.
  if (name.endsWith(".1pux")) return "onepassword-1pux";

  if (name.endsWith(".xml")) return "keepass-xml";

  // CSV-based formats — disambiguate via the header row.
  if (name.endsWith(".csv") || input.type === "text/csv") {
    const header = firstLine(input.sample).toLowerCase();
    if (header.includes("login_uri") || header.includes("login_username")) {
      return "bitwarden-csv";
    }
    if (header.includes("grouping") && header.includes("fav") && header.includes("extra")) {
      return "lastpass-csv";
    }
    if (header.startsWith("title,") || header.includes("otpauth")) {
      return "onepassword-csv";
    }
    // Fall back to Bitwarden — the historical default.
    return "bitwarden-csv";
  }

  // XML sniff even if extension was stripped.
  if (input.sample.includes("<KeePassFile")) return "keepass-xml";

  // ZIP magic bytes.
  if (input.sample.startsWith("PK")) return "onepassword-1pux";

  return null;
}

function firstLine(sample: string): string {
  const newlineIndex = sample.search(/\r?\n/);
  return newlineIndex < 0 ? sample : sample.slice(0, newlineIndex);
}

async function toDetectInput(file: File | DetectInput): Promise<DetectInput> {
  if (typeof (file as File).arrayBuffer === "function") {
    const realFile = file as File;
    const slice = realFile.slice(0, 4096);
    const sample = await slice.text();
    return { name: realFile.name, type: realFile.type, sample };
  }
  return file as DetectInput;
}
