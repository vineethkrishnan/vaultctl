// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/base64"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/secure"
)

func badBase64(field string) error {
	return domain.NewInvalid(field, "invalid base64")
}

// decodeAuthHashSecret decodes a base64-encoded authHash into a memguard
// Secret. The decoded source slice is wiped by memguard during the copy,
// so the caller receives a Secret whose bytes live in locked memory.
// Callers MUST defer Destroy on the returned Secret.
//
// Returning a Secret (rather than raw []byte) forces every auth handler
// to borrow the bytes through Secret.Open - any plaintext authHash copy
// is confined to the narrow window of a single handler call.
func decodeAuthHashSecret(s string) (*secure.Secret, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, badBase64("authHash")
	}
	return secure.NewSecretFromBytes(raw), nil
}

// ===========================================================================
// Auth DTOs
// ===========================================================================

type RegisterRequest struct {
	Email                       string `json:"email"`
	Name                        string `json:"name"`
	AuthHash                    string `json:"authHash"` // base64
	Salt                        string `json:"salt"`     // base64
	MasterPasswordPreflight     string `json:"masterPasswordPreflight"`
	KDFIterations               uint32 `json:"kdfIterations"`
	KDFMemoryKB                 uint32 `json:"kdfMemoryKB"`
	KDFParallelism              uint8  `json:"kdfParallelism"`
	EncryptedPrivateKey         string `json:"encryptedPrivateKey"`
	EncryptedIdentityPrivateKey string `json:"encryptedIdentityPrivateKey"`
	PublicKey                   string `json:"publicKey"`
	PublicKeySignature          string `json:"publicKeySignature"`
	IdentityPublicKey           string `json:"identityPublicKey"`
	// RecoveryWrappedPrivateKey / RecoveryWrappedIdentityPrivateKey are the
	// private keys wrapped under the recovery key (base64 wire blob). Optional.
	RecoveryWrappedPrivateKey         string `json:"recoveryWrappedPrivateKey,omitempty"`
	RecoveryWrappedIdentityPrivateKey string `json:"recoveryWrappedIdentityPrivateKey,omitempty"`
	InviteToken                       string `json:"inviteToken,omitempty"`  // required when registration mode is "invite"
	PasswordHint                      string `json:"passwordHint,omitempty"` // optional plaintext hint, server-encrypted (H4)
}

type RegisterResponse struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

type LoginRequest struct {
	Email      string `json:"email"`
	AuthHash   string `json:"authHash"` // redacted via LOG_REDACT_FIELDS (C4)
	DeviceName string `json:"deviceName"`
}

type LoginResponse struct {
	UserID           string `json:"userId"`
	Role             string `json:"role"`
	AccessToken      string `json:"accessToken"`
	RefreshToken     string `json:"refreshToken"`
	SessionID        string `json:"sessionId"`
	RefreshExpiresAt string `json:"refreshExpiresAt"`
	UpgradeAuthHash  bool   `json:"upgradeAuthHash,omitempty"`

	// User crypto material for client-side key hydration (§4.2)
	EncryptedPrivateKey         string `json:"encryptedPrivateKey"`
	EncryptedIdentityPrivateKey string `json:"encryptedIdentityPrivateKey"`
	PublicKey                   string `json:"publicKey"`
	PublicKeySignature          string `json:"publicKeySignature"`
	IdentityPublicKey           string `json:"identityPublicKey"`

	// Vault memberships with wrapped keys
	Vaults []VaultMembershipDTO `json:"vaults"`
}

// VaultMembershipDTO is a vault + the caller's wrapped key for that vault.
type VaultMembershipDTO struct {
	VaultID           string `json:"vaultId"`
	VaultName         string `json:"vaultName"`
	VaultType         string `json:"vaultType"`
	EncryptedVaultKey string `json:"encryptedVaultKey"`
	SenderID          string `json:"senderId"`
	WrapSignature     string `json:"wrapSignature"`
	Role              string `json:"role"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type RefreshResponse struct {
	AccessToken      string `json:"accessToken"`
	RefreshToken     string `json:"refreshToken"`
	RefreshExpiresAt string `json:"refreshExpiresAt"`
}

type LogoutRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type PreloginResponse struct {
	Salt        string `json:"salt"` // base64
	Iterations  uint32 `json:"iterations"`
	MemoryKB    uint32 `json:"memoryKB"`
	Parallelism uint8  `json:"parallelism"`
}

// ===========================================================================
// Password Hint DTOs
// ===========================================================================

type PasswordHintResponse struct {
	Hint string `json:"hint"`
}

// ===========================================================================
// Recovery DTOs
// ===========================================================================

type RecoveryVerifyRequest struct {
	Email string `json:"email"`
}

type RecoveryVerifyResponse struct {
	// Private keys wrapped under the recovery key (base64 wire blob). Empty
	// when the account has no recovery kit on file.
	RecoveryWrappedPrivateKey         string `json:"recoveryWrappedPrivateKey"`
	RecoveryWrappedIdentityPrivateKey string `json:"recoveryWrappedIdentityPrivateKey"`
	Salt                              string `json:"salt"`
	Iterations                        uint32 `json:"iterations"`
	MemoryKB                          uint32 `json:"memoryKB"`
	Parallelism                       uint8  `json:"parallelism"`
}

type RecoveryResetRequest struct {
	Email                       string `json:"email"`
	NewAuthHash                 string `json:"newAuthHash"`                 // base64
	EncryptedPrivateKey         string `json:"encryptedPrivateKey"`         // base64 wire blob
	EncryptedIdentityPrivateKey string `json:"encryptedIdentityPrivateKey"` // base64 wire blob
}

type RecoveryResetResponse struct {
	AccessToken      string `json:"accessToken"`
	RefreshToken     string `json:"refreshToken"`
	RefreshExpiresAt string `json:"refreshExpiresAt"`
}

// RecoveryRotateRequest carries the private keys freshly wrapped under a new
// recovery key (base64 wire blobs). Used by the settings regenerate flow.
type RecoveryRotateRequest struct {
	RecoveryWrappedPrivateKey         string `json:"recoveryWrappedPrivateKey"`
	RecoveryWrappedIdentityPrivateKey string `json:"recoveryWrappedIdentityPrivateKey"`
}

type RecoveryRotateResponse struct {
	OK bool `json:"ok"`
}

// OKResponse is a generic success acknowledgement.
type OKResponse struct {
	OK bool `json:"ok"`
}

// ===========================================================================
// Import DTOs
// ===========================================================================

type ImportItemDTO struct {
	ItemType      string  `json:"itemType"`
	EncryptedData string  `json:"encryptedData"` // base64 wire-format blob
	EncryptedName string  `json:"encryptedName"` // base64 wire-format blob
	FolderID      *string `json:"folderId,omitempty"`
}

type ImportRequest struct {
	VaultID string          `json:"vaultId"`
	Items   []ImportItemDTO `json:"items"`
}

type ImportResponse struct {
	ImportedCount int `json:"importedCount"`
}

// ===========================================================================
// Admin Backup DTOs
// ===========================================================================

type BackupInfoDTO struct {
	Filename  string `json:"filename"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"createdAt"`
}

type ListBackupsResponse struct {
	Backups []BackupInfoDTO `json:"backups"`
}

// ===========================================================================
// Item DTOs
// ===========================================================================

type ItemCreateRequest struct {
	FolderID      *string `json:"folderId,omitempty"`
	ItemType      string  `json:"itemType"`
	EncryptedData string  `json:"encryptedData"` // base64 wire-format blob
	EncryptedName string  `json:"encryptedName"`
	Favorite      bool    `json:"favorite,omitempty"`
	Reprompt      bool    `json:"reprompt,omitempty"`
}

type ItemUpdateRequest struct {
	FolderID      *string `json:"folderId,omitempty"`
	EncryptedData string  `json:"encryptedData"`
	EncryptedName string  `json:"encryptedName"`
	Favorite      bool    `json:"favorite,omitempty"`
	Reprompt      bool    `json:"reprompt,omitempty"`
}

type ItemResponse struct {
	ID            string  `json:"id"`
	VaultID       string  `json:"vaultId"`
	FolderID      *string `json:"folderId,omitempty"`
	ItemType      string  `json:"itemType"`
	EncryptedData string  `json:"encryptedData"`
	EncryptedName string  `json:"encryptedName"`
	Favorite      bool    `json:"favorite"`
	Reprompt      bool    `json:"reprompt"`
	Trashed       bool    `json:"trashed"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedAt     string  `json:"updatedAt"`
}

// ===========================================================================
// Folder DTOs
// ===========================================================================

type FolderCreateRequest struct {
	EncryptedName string `json:"encryptedName"`
}

type FolderResponse struct {
	ID            string `json:"id"`
	VaultID       string `json:"vaultId"`
	EncryptedName string `json:"encryptedName"`
	CreatedAt     string `json:"createdAt"`
}

// ===========================================================================
// Step-Up DTOs
// ===========================================================================

type StepUpRequest struct {
	AuthHash string `json:"authHash"` // base64 re-derived authHash
}

type StepUpResponse struct {
	AccessToken string `json:"accessToken"`
}

// ===========================================================================
// Password Change DTOs
// ===========================================================================

type PasswordChangeRequest struct {
	OldAuthHash                 string `json:"oldAuthHash"`                 // base64
	NewAuthHash                 string `json:"newAuthHash"`                 // base64
	EncryptedPrivateKey         string `json:"encryptedPrivateKey"`         // base64 wire blob
	EncryptedIdentityPrivateKey string `json:"encryptedIdentityPrivateKey"` // base64 wire blob
}

type PasswordChangeResponse struct {
	AccessToken      string `json:"accessToken"`
	RefreshToken     string `json:"refreshToken"`
	RefreshExpiresAt string `json:"refreshExpiresAt"`
}

// ===========================================================================
// TOTP DTOs
// ===========================================================================

type TOTPSetupResponse struct {
	Secret     string `json:"secret"`     // base32 for manual entry
	OtpauthURL string `json:"otpauthUrl"` // for QR code
}

type TOTPCodeRequest struct {
	Code string `json:"code"` // 6-digit TOTP code
}

// ===========================================================================
// Vault DTOs
// ===========================================================================

type VaultCreateRequest struct {
	Name              string `json:"name"`
	Type              string `json:"type"`
	EncryptedVaultKey string `json:"encryptedVaultKey"`
	WrapSignature     string `json:"wrapSignature"`
}

type VaultResponse struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Type              string `json:"type"`
	Role              string `json:"role"`
	EncryptedVaultKey string `json:"encryptedVaultKey"`
	SenderID          string `json:"senderId"`
	WrapSignature     string `json:"wrapSignature"`
	CreatedAt         string `json:"createdAt"`
}

// ===========================================================================
// Sharing DTOs
// ===========================================================================

type ShareVaultRequest struct {
	RecipientUserID   string `json:"recipientUserId"`
	EncryptedVaultKey string `json:"encryptedVaultKey"`
	WrapSignature     string `json:"wrapSignature"`
	Role              string `json:"role"`
}

type RemoveMemberResponse struct {
	RekeyRequired    bool                 `json:"rekeyRequired"`
	RemainingMembers []VaultMembershipDTO `json:"remainingMembers"`
}

type RekeyBlobDTO struct {
	UserID            string `json:"userId"`
	EncryptedVaultKey string `json:"encryptedVaultKey"`
	WrapSignature     string `json:"wrapSignature"`
}

type ItemReblobDTO struct {
	ItemID        string `json:"itemId"`
	EncryptedData string `json:"encryptedData"`
	EncryptedName string `json:"encryptedName"`
}

type RekeyVaultRequest struct {
	NewKeys []RekeyBlobDTO  `json:"newKeys"`
	Items   []ItemReblobDTO `json:"items"`
}

type MemberResponse struct {
	UserID            string `json:"userId"`
	Role              string `json:"role"`
	EncryptedVaultKey string `json:"encryptedVaultKey"`
	SenderID          string `json:"senderId"`
	WrapSignature     string `json:"wrapSignature"`
	AddedAt           string `json:"addedAt"`
}

// ===========================================================================
// Invite DTOs
// ===========================================================================

type CreateInviteRequest struct {
	Email     string `json:"email"`
	Role      string `json:"role"`
	ExpiresIn string `json:"expiresIn"` // duration string, e.g. "24h"
}

type CreateInviteResponse struct {
	InviteID string `json:"inviteId"`
	Token    string `json:"token"`
}

type InviteResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	InviterID string `json:"inviterId"`
	ExpiresAt string `json:"expiresAt"`
	CreatedAt string `json:"createdAt"`
}

type RedeemInviteRequest struct {
	Token string `json:"token"`
}

type RedeemInviteResponse struct {
	OrgID string `json:"orgId"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

// ===========================================================================
// API Key DTOs
// ===========================================================================

type CreateAPIKeyRequest struct {
	Name      string  `json:"name"`
	ExpiresIn *string `json:"expiresIn,omitempty"` // duration string
}

type CreateAPIKeyResponse struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Key       string  `json:"key"` // raw key, shown only once
	KeyPrefix string  `json:"keyPrefix"`
	ExpiresAt *string `json:"expiresAt,omitempty"`
}

type APIKeyResponse struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	KeyPrefix  string  `json:"keyPrefix"`
	LastUsedAt *string `json:"lastUsedAt,omitempty"`
	ExpiresAt  *string `json:"expiresAt,omitempty"`
	CreatedAt  string  `json:"createdAt"`
}

// ===========================================================================
// User Profile DTOs
// ===========================================================================

type UserProfileResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	CreatedAt string `json:"createdAt"`
}

type UpdateProfileRequest struct {
	Name string `json:"name"`
}

// ===========================================================================
// Session DTOs
// ===========================================================================

type SessionResponse struct {
	ID           string  `json:"id"`
	DeviceName   string  `json:"deviceName"`
	IPAddress    string  `json:"ipAddress"`
	LastActiveAt *string `json:"lastActiveAt,omitempty"`
	CreatedAt    string  `json:"createdAt"`
}

// ===========================================================================
// Public Key DTOs
// ===========================================================================

type PublicKeyResponse struct {
	UserID            string `json:"userId"`
	PublicKey         string `json:"publicKey"`
	IdentityPublicKey string `json:"identityPublicKey"`
}

// ===========================================================================
// Organization DTOs
// ===========================================================================

type CreateOrgRequest struct {
	Name string `json:"name"`
}

type OrgResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedBy string `json:"createdBy"`
	CreatedAt string `json:"createdAt"`
}

type OrgMemberResponse struct {
	OrgID      string  `json:"orgId"`
	UserID     string  `json:"userId"`
	Role       string  `json:"role"`
	InvitedAt  string  `json:"invitedAt"`
	AcceptedAt *string `json:"acceptedAt,omitempty"`
}

type UpdateMemberRoleRequest struct {
	Role string `json:"role"`
}

// RemoveOrgMemberResponse carries the rekey correlation handle and the list
// of shared vaults the admin client must re-encrypt after a member removal
// (C2 unconditional rekey).
type RemoveOrgMemberResponse struct {
	RekeyJobID     string   `json:"rekeyJobId"`
	AffectedVaults []string `json:"affectedVaults"`
}

// ===========================================================================
// Trash DTOs
// ===========================================================================

type PurgeTrashResponse struct {
	Purged int `json:"purged"`
}

// ===========================================================================
// Helpers
// ===========================================================================

// decodeB64Blob parses a base64-encoded wire blob into an EncryptedBlob.
func decodeB64Blob(s string) (crypto.EncryptedBlob, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return crypto.EncryptedBlob{}, badBase64("encryptedBlob")
	}
	return crypto.ParseBlob(raw)
}

// encodeB64Blob is the inverse.
func encodeB64Blob(b crypto.EncryptedBlob) string {
	if b.Version == 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

func encodeB64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

// AttachmentResponse is the metadata view of an encrypted attachment. The
// ciphertext itself is fetched from the download endpoint.
type AttachmentResponse struct {
	ID                string `json:"id"`
	ItemID            string `json:"itemId"`
	EncryptedFilename string `json:"encryptedFilename"`
	WrappedFileKey    string `json:"wrappedFileKey"`
	Size              int64  `json:"size"`
	SHA256            string `json:"sha256"`
	CreatedAt         string `json:"createdAt"`
}

func attachmentToDTO(a vault.Attachment) AttachmentResponse {
	return AttachmentResponse{
		ID:                string(a.ID),
		ItemID:            string(a.ItemID),
		EncryptedFilename: a.EncryptedFilename,
		WrappedFileKey:    a.WrappedFileKey,
		Size:              a.CiphertextSize,
		SHA256:            encodeB64(a.CiphertextSHA256),
		CreatedAt:         a.CreatedAt.UTC().Format(timeFormat),
	}
}

// decodeB64 decodes a base64 string to raw bytes.
func decodeB64(s string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, badBase64("base64Field")
	}
	return raw, nil
}

// decodeOptionalB64 decodes a base64 string, returning nil for an empty input
// so optional wire blobs are stored as NULL rather than empty bytes.
func decodeOptionalB64(s string) ([]byte, error) {
	if s == "" {
		return nil, nil
	}
	return decodeB64(s)
}

// decodeB64Signature decodes a base64-encoded Ed25519 signature.
func decodeB64Signature(s string) (crypto.Signature, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return crypto.Signature{}, badBase64("signature")
	}
	return crypto.NewEd25519Signature(raw)
}

// decodeB64PublicKey decodes a base64-encoded public key.
func decodeB64PublicKey(s string) (crypto.PublicKey, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return crypto.PublicKey{}, badBase64("publicKey")
	}
	return crypto.NewPublicKey(raw)
}

// itemToDTO converts a domain item to the API response shape.
func itemToDTO(it vault.Item) ItemResponse {
	var folderID *string
	if it.FolderID != nil {
		s := string(*it.FolderID)
		folderID = &s
	}
	return ItemResponse{
		ID: string(it.ID), VaultID: string(it.VaultID), FolderID: folderID,
		ItemType:      string(it.ItemType),
		EncryptedData: encodeB64Blob(it.EncryptedData),
		EncryptedName: encodeB64Blob(it.EncryptedName),
		Favorite:      it.Favorite, Reprompt: it.Reprompt,
		Trashed:   it.IsTrashed(),
		CreatedAt: it.CreatedAt.UTC().Format(timeFormat),
		UpdatedAt: it.UpdatedAt.UTC().Format(timeFormat),
	}
}

const timeFormat = "2006-01-02T15:04:05Z"
