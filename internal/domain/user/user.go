// SPDX-License-Identifier: AGPL-3.0-or-later

package user

import (
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// ID is an opaque user identifier (UUID in the DB). The domain treats it as
// an opaque string so that depguard can forbid the uuid package here.
type ID string

// IsZero reports whether the ID is unset.
func (u ID) IsZero() bool { return u == "" }

// String returns the underlying string.
func (u ID) String() string { return string(u) }

// KDFParams describes the client-side Argon2id parameters stored in the user
// row (PRD §9.1 kdf_iterations/kdf_memory/kdf_parallelism). Each user holds
// their own parameters so that we can bump the cost for new users without
// rewriting existing auth hashes.
type KDFParams struct {
	Iterations  uint32
	MemoryKB    uint32
	Parallelism uint8
}

// DefaultKDFParams returns the OWASP-aligned defaults from architecture §6.3.
func DefaultKDFParams() KDFParams {
	return KDFParams{Iterations: 3, MemoryKB: 65536, Parallelism: 4}
}

// Validate asserts the parameters are not weaker than a sane floor.
func (p KDFParams) Validate() error {
	if p.Iterations < 1 {
		return domain.NewInvalid("kdf_iterations", "must be >= 1")
	}
	if p.MemoryKB < 19456 { // OWASP 2023 floor: 19 MiB
		return domain.NewInvalid("kdf_memory", "must be >= 19456 KiB (19 MiB)")
	}
	if p.Parallelism < 1 {
		return domain.NewInvalid("kdf_parallelism", "must be >= 1")
	}
	return nil
}

// User is the User aggregate root. It contains only domain-level invariants;
// persistence mapping lives in internal/infrastructure/postgres.
//
// Security-review-driven additions (architecture §13):
//   - IdentityPublicKey + PublicKeySignature (C1)
//   - TotpLastCounter is OWNED by the application layer, not stored here;
//     the repository maps it separately. The domain just knows it exists.
type User struct {
	ID    ID
	Email Email
	Name  string

	KDFParams KDFParams
	// Salt is the per-user Argon2id salt (public - returned from prelogin).
	// It lives on the aggregate because prelogin needs it alongside KDFParams.
	Salt []byte

	// Encrypted key material (opaque to the domain)
	EncryptedPrivateKey         crypto.EncryptedBlob // alg=AlgAES256GCM, key=stretchedKey
	EncryptedIdentityPrivateKey crypto.EncryptedBlob // alg=AlgAES256GCM, key=stretchedKey (C1)

	PublicKey          crypto.PublicKey // RSA-2048
	PublicKeySignature crypto.Signature // Ed25519(id_priv, public_key)  (C1)
	IdentityPublicKey  crypto.PublicKey // Ed25519                       (C1)

	// Recovery-kit material: the private keys wrapped under the random
	// recovery key (NOT the master password). Nil until the user has a
	// recovery kit on file. Opaque wire-format AES-GCM blobs.
	RecoveryWrappedPrivateKey         []byte
	RecoveryWrappedIdentityPrivateKey []byte

	// EncryptedPasswordHint is a server-encrypted (H4/AES-256-GCM) hint that
	// helps the user remember their master password. Optional - nil means no
	// hint was set during registration.
	EncryptedPasswordHint []byte

	Role        Role
	TOTPEnabled bool

	// EmailVerified is set once the user confirms their address via an emailed
	// one-time code. EmailVerifiedAt records when (nil until verified).
	EmailVerified   bool
	EmailVerifiedAt *time.Time

	FailedLoginAttempts int
	LockedUntil         *time.Time

	CreatedAt time.Time
	UpdatedAt time.Time
}

// MaxNameLength mirrors users.name VARCHAR(255).
const MaxNameLength = 255

// Validate asserts every User invariant.
func (u User) Validate() error {
	if u.ID.IsZero() {
		return domain.NewInvalid("id", "required")
	}
	if err := u.Email.MustBeValid("email"); err != nil {
		return err
	}
	if u.Name == "" {
		return domain.NewInvalid("name", "required")
	}
	if len(u.Name) > MaxNameLength {
		return domain.NewInvalid("name", "too long")
	}
	if len(u.Salt) < 16 {
		return domain.NewInvalid("salt", "must be at least 16 bytes")
	}
	if err := u.KDFParams.Validate(); err != nil {
		return err
	}
	if err := u.EncryptedPrivateKey.Validate(); err != nil {
		return domain.NewInvalid("encrypted_private_key", err.Error())
	}
	if err := u.EncryptedIdentityPrivateKey.Validate(); err != nil {
		return domain.NewInvalid("encrypted_identity_private_key", err.Error())
	}
	if u.PublicKey.IsZero() {
		return domain.NewInvalid("public_key", "required")
	}
	if u.IdentityPublicKey.IsZero() {
		return domain.NewInvalid("identity_public_key", "required")
	}
	if u.PublicKeySignature.IsZero() {
		return domain.NewInvalid("public_key_signature", "required")
	}
	if !u.Role.IsValid() {
		return domain.NewInvalid("role", "unknown value")
	}
	if u.FailedLoginAttempts < 0 {
		return domain.NewInvalid("failed_login_attempts", "must be >= 0")
	}
	return nil
}

// IsLocked reports whether the user is currently within a lockout window.
func (u User) IsLocked(now time.Time) bool {
	return u.LockedUntil != nil && u.LockedUntil.After(now)
}
