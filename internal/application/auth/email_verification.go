// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// Email-verification sentinels surfaced to the API layer.
var (
	ErrNoVerificationPending = errors.New("auth: no verification code pending")
	ErrVerificationExpired   = errors.New("auth: verification code expired")
	ErrVerificationAttempts  = errors.New("auth: too many verification attempts")
	ErrVerificationInvalid   = errors.New("auth: invalid verification code")
)

// VerificationEmailSender delivers the one-time code. *email.Service satisfies
// it; the use case depends on the narrow interface so it stays testable.
type VerificationEmailSender interface {
	SendVerificationCode(ctx context.Context, to, code string, ttl time.Duration) error
}

// SendEmailVerification generates a fresh code, stores its HMAC digest, and
// emails the plaintext. Used on registration and on explicit resend.
type SendEmailVerification struct {
	Verifications ports.EmailVerificationRepository
	HMAC          ports.HMACer
	Clock         ports.Clock
	Sender        VerificationEmailSender
	CodeTTL       time.Duration
}

// Execute issues and emails a code for the user. A nil Sender (no mailer wired)
// is a no-op so a mail-less deployment doesn't error on register.
func (uc *SendEmailVerification) Execute(ctx context.Context, userID user.ID, to string) error {
	if uc.Sender == nil {
		return nil
	}
	code, err := generateOTP()
	if err != nil {
		return fmt.Errorf("generate code: %w", err)
	}
	now := uc.Clock.Now()
	rec := user.EmailVerification{
		UserID:    userID,
		CodeHash:  uc.HMAC.HashString(code),
		ExpiresAt: now.Add(uc.ttl()),
		CreatedAt: now,
	}
	if err := uc.Verifications.Upsert(ctx, rec); err != nil {
		return fmt.Errorf("store verification: %w", err)
	}
	return uc.Sender.SendVerificationCode(ctx, to, code, uc.ttl())
}

func (uc *SendEmailVerification) ttl() time.Duration {
	if uc.CodeTTL > 0 {
		return uc.CodeTTL
	}
	return 15 * time.Minute
}

// VerifyEmail consumes a code and flags the user's email as verified.
type VerifyEmail struct {
	Users         ports.UserRepository
	Verifications ports.EmailVerificationRepository
	HMAC          ports.HMACer
	Clock         ports.Clock
}

// Execute checks the supplied code. It is idempotent: verifying an
// already-verified account returns nil. Wrong codes increment the attempt
// counter; expired or exhausted codes are cleared and reported.
func (uc *VerifyEmail) Execute(ctx context.Context, userID user.ID, code string) error {
	u, err := uc.Users.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if u.EmailVerified {
		return nil
	}

	rec, err := uc.Verifications.Get(ctx, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return ErrNoVerificationPending
	}
	if err != nil {
		return err
	}

	now := uc.Clock.Now()
	if rec.Expired(now) {
		_ = uc.Verifications.Delete(ctx, userID)
		return ErrVerificationExpired
	}
	if rec.Exhausted() {
		return ErrVerificationAttempts
	}
	if !uc.HMAC.Equal(rec.CodeHash, uc.HMAC.HashString(code)) {
		_ = uc.Verifications.IncrementAttempts(ctx, userID)
		return ErrVerificationInvalid
	}

	if err := uc.Users.MarkEmailVerified(ctx, userID, now); err != nil {
		return fmt.Errorf("mark verified: %w", err)
	}
	_ = uc.Verifications.Delete(ctx, userID)
	return nil
}

// generateOTP returns a uniform 6-digit numeric code.
func generateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
