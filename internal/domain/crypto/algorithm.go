// Package crypto holds domain-level crypto value objects. It describes what
// a ciphertext blob, symmetric key, and identity key ARE — it does NOT
// perform any cryptographic operation. Actual encrypt/decrypt lives in
// internal/infrastructure/crypto, behind a port defined in application.
//
// This package is the authoritative source for PRD §9.9 (ciphertext blob
// format) and the [C5] finding from the security review.
package crypto

import "fmt"

// BlobVersion is the 1-byte version prefix on every EncryptedBlob.
type BlobVersion byte

// V1 is the v1 blob version. Bump only when the envelope shape itself changes
// (not when adding a new AlgID).
const V1 BlobVersion = 0x01

// AlgID enumerates allowed algorithm identifiers for an EncryptedBlob.
// See PRD §9.9 for the authoritative table.
type AlgID byte

const (
	// AlgAES256GCM — 96-bit nonce, 128-bit tag. Used for item data/name,
	// folder names, encrypted_private_key, encrypted_identity_private_key,
	// totp_secret, encrypted_password_hint.
	AlgAES256GCM AlgID = 0x01

	// AlgRSAOAEPSHA256 — RSA-OAEP-SHA256-2048. Used for encrypted_vault_key
	// in SHARED vaults.
	AlgRSAOAEPSHA256 AlgID = 0x02

	// AlgAES256KW — AES Key Wrap (NIST SP 800-38F). Used for
	// encrypted_vault_key in PERSONAL vaults (M4).
	AlgAES256KW AlgID = 0x03
)

// IsValid reports whether a is one of the enumerated v1 algorithm IDs.
func (a AlgID) IsValid() bool {
	switch a {
	case AlgAES256GCM, AlgRSAOAEPSHA256, AlgAES256KW:
		return true
	default:
		return false
	}
}

// String returns a stable human name — used in errors, audit logs, and
// depguard reasons. NEVER depend on this string in binary protocols.
func (a AlgID) String() string {
	switch a {
	case AlgAES256GCM:
		return "AES-256-GCM"
	case AlgRSAOAEPSHA256:
		return "RSA-OAEP-SHA256-2048"
	case AlgAES256KW:
		return "AES-256-KW"
	default:
		return fmt.Sprintf("unknown(0x%02x)", byte(a))
	}
}

// NonceSize returns the expected nonce length in bytes for the algorithm, or
// 0 for algorithms that don't carry a nonce (RSA-OAEP, AES-KW).
func (a AlgID) NonceSize() int {
	switch a {
	case AlgAES256GCM:
		return 12
	default:
		return 0
	}
}

// TagSize returns the AEAD tag size in bytes, or 0 if the algorithm's
// ciphertext is length-determined rather than tag-suffixed.
func (a AlgID) TagSize() int {
	switch a {
	case AlgAES256GCM:
		return 16
	case AlgAES256KW:
		return 8
	default:
		return 0
	}
}
