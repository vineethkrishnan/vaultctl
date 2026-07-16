// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zod schemas for the decrypted JSON payload inside each item's encryptedData.
 * These describe the PLAINTEXT structure after client-side decryption.
 */

import { z } from "zod";

const customFieldSchema = z.object({
  name: z.string(),
  value: z.string(),
  type: z.enum(["text", "hidden", "boolean", "url", "markdown"]).default("text"),
});

export type CustomField = z.infer<typeof customFieldSchema>;

const passwordHistoryEntrySchema = z.object({
  password: z.string(),
  changedAt: z.string(),
});

export type PasswordHistoryEntry = z.infer<typeof passwordHistoryEntrySchema>;

// ===========================================================================
// Login
// ===========================================================================

export const loginDataSchema = z.object({
  username: z.string().default(""),
  password: z.string().default(""),
  uri: z.string().default(""),
  totp: z.string().default(""),
  notes: z.string().default(""),
  customFields: z.array(customFieldSchema).default([]),
  passwordHistory: z.array(passwordHistoryEntrySchema).default([]),
});
export type LoginData = z.infer<typeof loginDataSchema>;

// ===========================================================================
// Secure Note
// ===========================================================================

export const secureNoteDataSchema = z.object({
  content: z.string().default(""),
  notes: z.string().default(""),
  customFields: z.array(customFieldSchema).default([]),
});
export type SecureNoteData = z.infer<typeof secureNoteDataSchema>;

// ===========================================================================
// Credit Card
// ===========================================================================

export const creditCardDataSchema = z.object({
  cardholderName: z.string().default(""),
  number: z.string().default(""),
  expiry: z.string().default(""),
  cvv: z.string().default(""),
  cardType: z.string().default(""),
  notes: z.string().default(""),
  customFields: z.array(customFieldSchema).default([]),
});
export type CreditCardData = z.infer<typeof creditCardDataSchema>;

// ===========================================================================
// Identity
// ===========================================================================

export const identityDataSchema = z.object({
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  address: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
  country: z.string().default(""),
  postalCode: z.string().default(""),
  ssn: z.string().default(""),
  passportNumber: z.string().default(""),
  licenseNumber: z.string().default(""),
  notes: z.string().default(""),
  customFields: z.array(customFieldSchema).default([]),
});
export type IdentityData = z.infer<typeof identityDataSchema>;

// ===========================================================================
// API Key
// ===========================================================================

export const apiKeyDataSchema = z.object({
  key: z.string().default(""),
  environment: z.string().default(""),
  serviceUrl: z.string().default(""),
  expiresAt: z.string().default(""),
  notes: z.string().default(""),
  customFields: z.array(customFieldSchema).default([]),
});
export type ApiKeyData = z.infer<typeof apiKeyDataSchema>;

// ===========================================================================
// SSH Key
// ===========================================================================

export const sshKeyDataSchema = z.object({
  publicKey: z.string().default(""),
  privateKey: z.string().default(""),
  passphrase: z.string().default(""),
  keyType: z.string().default(""),
  fingerprint: z.string().default(""),
  host: z.string().default(""),
  notes: z.string().default(""),
  customFields: z.array(customFieldSchema).default([]),
});
export type SSHKeyData = z.infer<typeof sshKeyDataSchema>;

// ===========================================================================
// GPG Key
// ===========================================================================

// publicKey/privateKey hold ASCII-armored blocks. They are multi-line and
// whitespace-significant: an armored block whose line structure or trailing
// CRC is altered will not import, so both must be rendered with a control
// that preserves newlines verbatim (see GPGKeyFields).
export const gpgKeyDataSchema = z.object({
  uid: z.string().default(""),
  keyId: z.string().default(""),
  fingerprint: z.string().default(""),
  keyType: z.string().default(""),
  expiresAt: z.string().default(""),
  publicKey: z.string().default(""),
  privateKey: z.string().default(""),
  passphrase: z.string().default(""),
  notes: z.string().default(""),
  customFields: z.array(customFieldSchema).default([]),
});
export type GPGKeyData = z.infer<typeof gpgKeyDataSchema>;

// ===========================================================================
// Passkey
// ===========================================================================

export const passkeyDataSchema = z.object({
  rpId: z.string().default(""),
  rpName: z.string().default(""),
  credentialId: z.string().default(""),
  userHandle: z.string().default(""),
  publicKey: z.string().default(""),
  discoverable: z.boolean().default(false),
  notes: z.string().default(""),
  customFields: z.array(customFieldSchema).default([]),
});
export type PasskeyData = z.infer<typeof passkeyDataSchema>;

// ===========================================================================
// Union type for all item data
// ===========================================================================

export type ItemData =
  | LoginData
  | SecureNoteData
  | CreditCardData
  | IdentityData
  | ApiKeyData
  | SSHKeyData
  | PasskeyData
  | GPGKeyData;

export const itemDataSchemas: Record<string, z.ZodSchema> = {
  login: loginDataSchema,
  secure_note: secureNoteDataSchema,
  credit_card: creditCardDataSchema,
  identity: identityDataSchema,
  api_key: apiKeyDataSchema,
  ssh_key: sshKeyDataSchema,
  passkey: passkeyDataSchema,
  gpg_key: gpgKeyDataSchema,
};
