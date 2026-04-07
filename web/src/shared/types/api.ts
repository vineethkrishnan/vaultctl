import { z } from "zod";

// ===========================================================================
// Auth
// ===========================================================================

export const PreloginResponseSchema = z.object({
  salt: z.string(),
  iterations: z.number(),
  memoryKB: z.number(),
  parallelism: z.number(),
});
export type PreloginResponse = z.infer<typeof PreloginResponseSchema>;

export const VaultMembershipSchema = z.object({
  vaultId: z.string(),
  vaultName: z.string(),
  vaultType: z.enum(["personal", "shared"]),
  encryptedVaultKey: z.string(),
  senderId: z.string(),
  wrapSignature: z.string(),
  role: z.string(),
});
export type VaultMembership = z.infer<typeof VaultMembershipSchema>;

export const LoginResponseSchema = z.object({
  userId: z.string(),
  role: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  sessionId: z.string(),
  refreshExpiresAt: z.string(),
  upgradeAuthHash: z.boolean().optional(),
  encryptedPrivateKey: z.string(),
  encryptedIdentityPrivateKey: z.string(),
  publicKey: z.string(),
  publicKeySignature: z.string(),
  identityPublicKey: z.string(),
  vaults: z.array(VaultMembershipSchema),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const RegisterResponseSchema = z.object({
  userId: z.string(),
  role: z.string(),
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  refreshExpiresAt: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

// ===========================================================================
// Vaults
// ===========================================================================

export const VaultResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["personal", "shared"]),
  role: z.string(),
  encryptedVaultKey: z.string(),
  senderId: z.string(),
  wrapSignature: z.string(),
  createdAt: z.string(),
});
export type VaultResponse = z.infer<typeof VaultResponseSchema>;

// ===========================================================================
// Items
// ===========================================================================

export const ItemResponseSchema = z.object({
  id: z.string(),
  vaultId: z.string(),
  folderId: z.string().nullable().optional(),
  itemType: z.string(),
  encryptedData: z.string(),
  encryptedName: z.string(),
  favorite: z.boolean(),
  reprompt: z.boolean(),
  trashed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ItemResponse = z.infer<typeof ItemResponseSchema>;

// ===========================================================================
// Folders
// ===========================================================================

export const FolderResponseSchema = z.object({
  id: z.string(),
  vaultId: z.string(),
  encryptedName: z.string(),
  createdAt: z.string(),
});
export type FolderResponse = z.infer<typeof FolderResponseSchema>;

// ===========================================================================
// Item types
// ===========================================================================

export const ITEM_TYPES = [
  "login",
  "secure_note",
  "credit_card",
  "identity",
  "api_key",
  "ssh_key",
  "passkey",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// ===========================================================================
// Errors
// ===========================================================================

export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
