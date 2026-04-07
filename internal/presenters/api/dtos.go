package api

import (
	"encoding/base64"

	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// ===========================================================================
// Auth DTOs
// ===========================================================================

type RegisterRequest struct {
	Email                       string `json:"email"`
	Name                        string `json:"name"`
	AuthHash                    string `json:"authHash"` // base64
	Salt                        string `json:"salt"`      // base64
	MasterPasswordPreflight     string `json:"masterPasswordPreflight"`
	KDFIterations               uint32 `json:"kdfIterations"`
	KDFMemoryKB                 uint32 `json:"kdfMemoryKB"`
	KDFParallelism              uint8  `json:"kdfParallelism"`
	EncryptedPrivateKey         string `json:"encryptedPrivateKey"`
	EncryptedIdentityPrivateKey string `json:"encryptedIdentityPrivateKey"`
	PublicKey                   string `json:"publicKey"`
	PublicKeySignature          string `json:"publicKeySignature"`
	IdentityPublicKey           string `json:"identityPublicKey"`
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
// Helpers
// ===========================================================================

// decodeB64Blob parses a base64-encoded wire blob into an EncryptedBlob.
func decodeB64Blob(s string) (crypto.EncryptedBlob, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return crypto.EncryptedBlob{}, err
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
