// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared types for the import module.
 *
 * Importers produce PLAINTEXT ParsedItem arrays. Encryption happens downstream
 * in ImportDialog via the M6 crypto module. Never put ciphertext here.
 */

import { z } from "zod";

// ===========================================================================
// Format identifiers
// ===========================================================================

export type ImportFormat =
  | "bitwarden-csv"
  | "onepassword-1pux"
  | "onepassword-csv"
  | "lastpass-csv"
  | "keepass-xml"
  | "chrome-csv"
  | "firefox-csv";

// ===========================================================================
// ParsedItem - the common shape produced by every parser
// ===========================================================================

/**
 * Item type strings recognised by the vault. Keep in sync with
 * src/shared/types/item-data.ts (itemDataSchemas keys).
 */
export const itemTypeSchema = z.enum([
  "login",
  "secure_note",
  "credit_card",
  "identity",
  "api_key",
  "ssh_key",
  "passkey",
  "gpg_key",
]);
export type ItemType = z.infer<typeof itemTypeSchema>;

/**
 * Loose schema for the decrypted item payload. Parsers emit only string or
 * array fields; strict validation against loginDataSchema/etc. happens at
 * submission time.
 */
export const parsedItemSchema = z.object({
  name: z.string().min(1),
  type: itemTypeSchema,
  data: z.record(z.string(), z.unknown()),
});
export type ParsedItem = z.infer<typeof parsedItemSchema>;

export const parsedItemArraySchema = z.array(parsedItemSchema);

// ===========================================================================
// Importer contract
// ===========================================================================

export interface Importer {
  id: ImportFormat;
  label: string;
  /** Value for <input accept="..."> on the file input. */
  accept: string;
  /** Parse raw file bytes (or text) into ParsedItem[]. */
  parse(input: File | string | Uint8Array): Promise<ParsedItem[]>;
}
