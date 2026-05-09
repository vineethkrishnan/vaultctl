// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Public entrypoint for the import module. Components should import from
 * here rather than pulling individual parsers.
 */

import { importer as bitwardenCsv } from "./bitwarden-csv.js";
import { importer as onepasswordCsv } from "./onepassword-csv.js";
import { importer as onepassword1pux } from "./onepassword-1pux.js";
import { importer as lastpassCsv } from "./lastpass-csv.js";
import { importer as keepassXml } from "./keepass-xml.js";

import type { ImportFormat, Importer } from "./types.js";

export type { ImportFormat, Importer, ParsedItem } from "./types.js";
export { parsedItemSchema, parsedItemArraySchema, itemTypeSchema } from "./types.js";
export { detectFormat, detectFromInput } from "./detect.js";

const REGISTRY: Record<ImportFormat, Importer> = {
  "bitwarden-csv": bitwardenCsv,
  "onepassword-csv": onepasswordCsv,
  "onepassword-1pux": onepassword1pux,
  "lastpass-csv": lastpassCsv,
  "keepass-xml": keepassXml,
};

export function getImporter(format: ImportFormat): Importer {
  return REGISTRY[format];
}

export function listImporters(): readonly Importer[] {
  return Object.values(REGISTRY);
}
