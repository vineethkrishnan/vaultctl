// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// UserRepo implements ports.UserRepository using pgx/v5.
type UserRepo struct{ Pool *Pool }

// Create inserts a new user row with their server-hashed auth hash.
func (r *UserRepo) Create(ctx context.Context, u user.User, authHash string) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO users (
			id, email, name, auth_hash, salt,
			kdf_iterations, kdf_memory, kdf_parallelism,
			encrypted_private_key, public_key, public_key_signature,
			identity_public_key, encrypted_identity_private_key,
			encrypted_password_hint,
			encrypted_recovery_wrapped_private_key, encrypted_recovery_wrapped_identity_private_key,
			role, locale, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
	`,
		u.ID, u.Email.String(), u.Name, authHash, u.Salt,
		u.KDFParams.Iterations, u.KDFParams.MemoryKB, u.KDFParams.Parallelism,
		encodeBlob(u.EncryptedPrivateKey), encodePublicKey(u.PublicKey), encodeSig(u.PublicKeySignature),
		encodePublicKey(u.IdentityPublicKey), encodeBlob(u.EncryptedIdentityPrivateKey),
		u.EncryptedPasswordHint,
		u.RecoveryWrappedPrivateKey, u.RecoveryWrappedIdentityPrivateKey,
		string(u.Role), user.NormalizeLocale(u.Locale), u.CreatedAt, u.UpdatedAt,
	)
	if isUniqueViolation(err) {
		return domain.ErrConflict
	}
	return err
}

// FindByEmail loads a user by normalised email.
func (r *UserRepo) FindByEmail(ctx context.Context, email user.Email) (user.User, error) {
	return r.query(ctx, "email = $1", email.String())
}

// FindByID loads a user by ID.
func (r *UserRepo) FindByID(ctx context.Context, id user.ID) (user.User, error) {
	return r.query(ctx, "id = $1", string(id))
}

func (r *UserRepo) query(ctx context.Context, where string, arg any) (user.User, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, email, name, salt,
		       kdf_iterations, kdf_memory, kdf_parallelism,
		       encrypted_private_key, public_key, public_key_signature,
		       identity_public_key, encrypted_identity_private_key,
		       encrypted_recovery_wrapped_private_key, encrypted_recovery_wrapped_identity_private_key,
		       totp_enabled, totp_last_counter, failed_login_attempts, locked_until,
		       email_verified, email_verified_at,
		       role, locale, timezone, created_at, updated_at
		FROM users WHERE `+where, arg)

	var (
		uid                                          string
		email, name                                  string
		salt                                         []byte
		iter, mem                                    uint32
		par                                          uint8
		encPriv, pubKey, pubKeySig, idPub, encIDPriv string
		recPriv, recIDPriv                           []byte
		totpEnabled                                  bool
		totpCounter                                  *int64
		failedAttempts                               int
		lockedUntil                                  *time.Time
		emailVerified                                bool
		emailVerifiedAt                              *time.Time
		role, locale, timezone                       string
		createdAt, updatedAt                         time.Time
	)
	err := row.Scan(&uid, &email, &name, &salt, &iter, &mem, &par,
		&encPriv, &pubKey, &pubKeySig, &idPub, &encIDPriv,
		&recPriv, &recIDPriv,
		&totpEnabled, &totpCounter, &failedAttempts, &lockedUntil,
		&emailVerified, &emailVerifiedAt,
		&role, &locale, &timezone, &createdAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return user.User{}, domain.ErrNotFound
	}
	if err != nil {
		return user.User{}, fmt.Errorf("scan user: %w", err)
	}
	em, err := user.NewEmail(email)
	if err != nil {
		return user.User{}, fmt.Errorf("decode email: %w", err)
	}
	priv, err := decodeBlob(encPriv)
	if err != nil {
		return user.User{}, err
	}
	idPriv, err := decodeBlob(encIDPriv)
	if err != nil {
		return user.User{}, err
	}
	pub, err := decodePublicKey(pubKey)
	if err != nil {
		return user.User{}, err
	}
	idp, err := decodePublicKey(idPub)
	if err != nil {
		return user.User{}, err
	}
	sig, err := decodeSig(pubKeySig)
	if err != nil {
		return user.User{}, err
	}
	return user.User{
		ID:                                user.ID(uid),
		Email:                             em,
		Name:                              name,
		Locale:                            user.NormalizeLocale(locale),
		Timezone:                          user.NormalizeTimezone(timezone),
		Salt:                              salt,
		KDFParams:                         user.KDFParams{Iterations: iter, MemoryKB: mem, Parallelism: par},
		EncryptedPrivateKey:               priv,
		EncryptedIdentityPrivateKey:       idPriv,
		RecoveryWrappedPrivateKey:         recPriv,
		RecoveryWrappedIdentityPrivateKey: recIDPriv,
		PublicKey:                         pub,
		IdentityPublicKey:                 idp,
		PublicKeySignature:                sig,
		TOTPEnabled:                       totpEnabled,
		EmailVerified:                     emailVerified,
		EmailVerifiedAt:                   emailVerifiedAt,
		FailedLoginAttempts:               failedAttempts,
		LockedUntil:                       lockedUntil,
		Role:                              user.Role(role),
		CreatedAt:                         createdAt,
		UpdatedAt:                         updatedAt,
	}, nil
}

// MarkEmailVerified flags the user's email as confirmed at the given time.
func (r *UserRepo) MarkEmailVerified(ctx context.Context, id user.ID, at time.Time) error {
	_, err := r.Pool.Exec(ctx, `
		UPDATE users SET email_verified = TRUE, email_verified_at = $2, updated_at = NOW()
		WHERE id = $1`,
		string(id), at)
	return err
}

// UpdateRecoveryWrappedKeys overwrites the recovery-wrapped private keys for a
// user, used when (re)generating a recovery kit.
func (r *UserRepo) UpdateRecoveryWrappedKeys(ctx context.Context, id user.ID, recPrivKey, recIDPrivKey []byte) error {
	tag, err := r.Pool.Exec(ctx, `
		UPDATE users SET encrypted_recovery_wrapped_private_key = $1,
		       encrypted_recovery_wrapped_identity_private_key = $2, updated_at = NOW()
		WHERE id = $3`,
		recPrivKey, recIDPrivKey, string(id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// UpdateProfile updates the user's display name.
func (r *UserRepo) UpdateProfile(ctx context.Context, id user.ID, name string) error {
	tag, err := r.Pool.Exec(ctx, `UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`, name, string(id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// SetLocale updates the user's transactional-email locale. The value is
// normalised to a supported locale before persistence.
func (r *UserRepo) SetLocale(ctx context.Context, id user.ID, locale string) error {
	tag, err := r.Pool.Exec(ctx, `UPDATE users SET locale = $1, updated_at = NOW() WHERE id = $2`,
		user.NormalizeLocale(locale), string(id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// SetTimezone updates the user's IANA timezone. The caller validates the name
// via time.LoadLocation before calling.
func (r *UserRepo) SetTimezone(ctx context.Context, id user.ID, timezone string) error {
	tag, err := r.Pool.Exec(ctx, `UPDATE users SET timezone = $1, updated_at = NOW() WHERE id = $2`,
		user.NormalizeTimezone(timezone), string(id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// AuthHash returns the stored server-side auth hash.
func (r *UserRepo) AuthHash(ctx context.Context, id user.ID) (string, error) {
	var h string
	err := r.Pool.QueryRow(ctx, `SELECT auth_hash FROM users WHERE id = $1`, string(id)).Scan(&h)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return h, err
}

// UpdateAuthHash replaces the stored hash.
func (r *UserRepo) UpdateAuthHash(ctx context.Context, id user.ID, authHash string) error {
	tag, err := r.Pool.Exec(ctx, `UPDATE users SET auth_hash = $1, updated_at = NOW() WHERE id = $2`, authHash, string(id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *UserRepo) UpdatePasswordMaterial(ctx context.Context, id user.ID, authHash string, encPrivKey, encIDPrivKey []byte) error {
	tag, err := r.Pool.Exec(ctx, `
		UPDATE users SET auth_hash = $1, encrypted_private_key = $2,
		       encrypted_identity_private_key = $3, updated_at = NOW()
		WHERE id = $4`,
		authHash, encodeBlobBytes(encPrivKey), encodeBlobBytes(encIDPrivKey), string(id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ApplyFailedLogin persists the increment + optional lockout.
func (r *UserRepo) ApplyFailedLogin(ctx context.Context, id user.ID, attempts int, lockedUntil *time.Time) error {
	_, err := r.Pool.Exec(ctx, `
		UPDATE users SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW() WHERE id = $3`,
		attempts, lockedUntil, string(id))
	return err
}

// ResetLoginFailures zeroes the counters.
func (r *UserRepo) ResetLoginFailures(ctx context.Context, id user.ID) error {
	_, err := r.Pool.Exec(ctx, `
		UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1`,
		string(id))
	return err
}

func (r *UserRepo) SetTOTPSecret(ctx context.Context, id user.ID, encryptedSecret []byte) error {
	_, err := r.Pool.Exec(ctx,
		`UPDATE users SET totp_secret = $1, updated_at = NOW() WHERE id = $2`,
		encryptedSecret, string(id))
	return err
}

func (r *UserRepo) GetTOTPSecret(ctx context.Context, id user.ID) ([]byte, int64, error) {
	var (
		secret  []byte
		counter *int64
	)
	err := r.Pool.QueryRow(ctx,
		`SELECT totp_secret, totp_last_counter FROM users WHERE id = $1`,
		string(id)).Scan(&secret, &counter)
	if err != nil {
		return nil, 0, err
	}
	var c int64
	if counter != nil {
		c = *counter
	}
	return secret, c, nil
}

func (r *UserRepo) EnableTOTP(ctx context.Context, id user.ID) error {
	_, err := r.Pool.Exec(ctx,
		`UPDATE users SET totp_enabled = TRUE, updated_at = NOW() WHERE id = $1`,
		string(id))
	return err
}

func (r *UserRepo) DisableTOTP(ctx context.Context, id user.ID) error {
	_, err := r.Pool.Exec(ctx,
		`UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_last_counter = NULL, updated_at = NOW() WHERE id = $1`,
		string(id))
	return err
}

// UpdateTOTPCounter persists the H6 anti-replay counter.
func (r *UserRepo) UpdateTOTPCounter(ctx context.Context, id user.ID, counter int64) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET totp_last_counter = $1 WHERE id = $2`, counter, string(id))
	return err
}

// GetHint returns the server-encrypted password hint for a user by email.
func (r *UserRepo) GetHint(ctx context.Context, email user.Email) ([]byte, error) {
	var hint []byte
	err := r.Pool.QueryRow(ctx,
		`SELECT encrypted_password_hint FROM users WHERE email = $1`,
		email.String()).Scan(&hint)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return hint, nil
}

// GetRecoveryMaterial returns the user's crypto material for recovery.
// This reuses FindByEmail - the domain already returns all needed fields.
func (r *UserRepo) GetRecoveryMaterial(ctx context.Context, email user.Email) (user.User, error) {
	return r.FindByEmail(ctx, email)
}

// UpdatePasswordMaterialAndHint atomically updates auth hash + re-encrypted
// private keys + encrypted password hint.
func (r *UserRepo) UpdatePasswordMaterialAndHint(ctx context.Context, id user.ID, authHash string, encPrivKey, encIDPrivKey, encHint []byte) error {
	tag, err := r.Pool.Exec(ctx, `
		UPDATE users SET auth_hash = $1, encrypted_private_key = $2,
		       encrypted_identity_private_key = $3, encrypted_password_hint = $4,
		       updated_at = NOW()
		WHERE id = $5`,
		authHash, encodeBlobBytes(encPrivKey), encodeBlobBytes(encIDPrivKey), encHint, string(id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// CountAll returns the total number of users.
func (r *UserRepo) CountAll(ctx context.Context) (int, error) {
	var n int
	if err := r.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// ===========================================================================
// helpers
// ===========================================================================

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
