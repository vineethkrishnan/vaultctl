// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// ===========================================================================
// Setup TOTP
// ===========================================================================

type TOTPSetupInput struct {
	Caller user.ID
}

type TOTPSetupOutput struct {
	Secret     string // base32, for manual entry
	OtpauthURL string // for QR code rendering
}

// TOTPSetup generates a new TOTP secret and stores it encrypted server-side.
// The secret is NOT enabled until the user verifies a code via TOTPEnable.
type TOTPSetup struct {
	Users     ports.UserRepository
	TOTP      ports.TOTPProvider
	Encrypter ports.DataEncrypter
	Issuer    string // e.g. "vaultctl"
}

func (uc *TOTPSetup) Execute(ctx context.Context, in TOTPSetupInput) (TOTPSetupOutput, error) {
	u, err := uc.Users.FindByID(ctx, in.Caller)
	if err != nil {
		return TOTPSetupOutput{}, fmt.Errorf("load user: %w", err)
	}

	secret, url, err := uc.TOTP.Generate(uc.Issuer, u.Email.String())
	if err != nil {
		return TOTPSetupOutput{}, fmt.Errorf("generate totp: %w", err)
	}

	// Encrypt the secret server-side (H5) with AAD binding to user
	aad := []byte("user:" + u.ID.String() + ":totp_secret")
	blob, err := uc.Encrypter.Encrypt([]byte(secret), aad)
	if err != nil {
		return TOTPSetupOutput{}, fmt.Errorf("encrypt totp secret: %w", err)
	}

	if err := uc.Users.SetTOTPSecret(ctx, u.ID, blob.Bytes()); err != nil {
		return TOTPSetupOutput{}, fmt.Errorf("store totp secret: %w", err)
	}

	return TOTPSetupOutput{Secret: secret, OtpauthURL: url}, nil
}

// ===========================================================================
// Enable TOTP (verify first code, then flip the flag)
// ===========================================================================

type TOTPEnableInput struct {
	Caller user.ID
	Code   string
}

// TOTPEnable verifies a TOTP code and enables 2FA on the user.
type TOTPEnable struct {
	Users     ports.UserRepository
	TOTP      ports.TOTPProvider
	Encrypter ports.DataEncrypter
	Clock     ports.Clock
}

func (uc *TOTPEnable) Execute(ctx context.Context, in TOTPEnableInput) error {
	secret, err := uc.decryptSecret(ctx, in.Caller)
	if err != nil {
		return err
	}

	counter, ok := uc.TOTP.Verify(secret, in.Code, uc.Clock.Now())
	if !ok {
		return ErrInvalidCredentials
	}

	if err := uc.Users.UpdateTOTPCounter(ctx, in.Caller, counter); err != nil {
		return fmt.Errorf("update counter: %w", err)
	}
	if err := uc.Users.EnableTOTP(ctx, in.Caller); err != nil {
		return fmt.Errorf("enable totp: %w", err)
	}
	return nil
}

func (uc *TOTPEnable) decryptSecret(ctx context.Context, userID user.ID) (string, error) {
	encSecret, _, err := uc.Users.GetTOTPSecret(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("load totp secret: %w", err)
	}
	if encSecret == nil {
		return "", fmt.Errorf("totp: no secret configured — call setup first")
	}
	blob, err := crypto.ParseBlob(encSecret)
	if err != nil {
		return "", fmt.Errorf("parse totp blob: %w", err)
	}
	aad := []byte("user:" + userID.String() + ":totp_secret")
	plaintext, err := uc.Encrypter.Decrypt(blob, aad)
	if err != nil {
		return "", fmt.Errorf("decrypt totp secret: %w", err)
	}
	return string(plaintext), nil
}

// ===========================================================================
// Disable TOTP
// ===========================================================================

type TOTPDisableInput struct {
	Caller user.ID
}

// TOTPDisable removes 2FA from the user. Requires step-up (enforced at router).
type TOTPDisable struct {
	Users ports.UserRepository
}

func (uc *TOTPDisable) Execute(ctx context.Context, in TOTPDisableInput) error {
	return uc.Users.DisableTOTP(ctx, in.Caller)
}

// ===========================================================================
// Verify TOTP (used during login when totp_enabled=true)
// ===========================================================================

type TOTPVerifyInput struct {
	Caller user.ID
	Code   string
}

// TOTPVerify checks a TOTP code during login. Returns error if invalid or
// replayed (H6).
type TOTPVerify struct {
	Users     ports.UserRepository
	TOTP      ports.TOTPProvider
	Encrypter ports.DataEncrypter
	Clock     ports.Clock
}

func (uc *TOTPVerify) Execute(ctx context.Context, in TOTPVerifyInput) error {
	encSecret, lastCounter, err := uc.Users.GetTOTPSecret(ctx, in.Caller)
	if err != nil {
		return fmt.Errorf("load totp secret: %w", err)
	}
	if encSecret == nil {
		return ErrInvalidCredentials
	}

	blob, err := crypto.ParseBlob(encSecret)
	if err != nil {
		return fmt.Errorf("parse totp blob: %w", err)
	}
	aad := []byte("user:" + in.Caller.String() + ":totp_secret")
	plaintext, err := uc.Encrypter.Decrypt(blob, aad)
	if err != nil {
		return fmt.Errorf("decrypt totp secret: %w", err)
	}
	secret := string(plaintext)

	counter, ok := uc.TOTP.Verify(secret, in.Code, uc.Clock.Now())
	if !ok {
		return ErrInvalidCredentials
	}

	// H6: reject replayed codes
	if counter <= lastCounter {
		return ErrInvalidCredentials
	}

	if err := uc.Users.UpdateTOTPCounter(ctx, in.Caller, counter); err != nil {
		return fmt.Errorf("update counter: %w", err)
	}
	return nil
}
