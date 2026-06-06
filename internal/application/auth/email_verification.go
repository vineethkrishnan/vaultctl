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
	ErrResendTooSoon         = errors.New("auth: verification code resent too recently")
)

// VerificationEmailSender delivers the one-time code. *email.Service satisfies
// it; the use case depends on the narrow interface so it stays testable.
type VerificationEmailSender interface {
	SendVerificationCode(ctx context.Context, to, locale, code string, ttl time.Duration) error
}

// SendEmailVerification generates a fresh code, stores its HMAC digest, and
// emails the plaintext. Used on registration and on explicit resend.
type SendEmailVerification struct {
	Verifications ports.EmailVerificationRepository
	HMAC          ports.HMACer
	Clock         ports.Clock
	Sender        VerificationEmailSender
	CodeTTL       time.Duration
	// ResendCooldown is the minimum gap between sends. A resend inside this
	// window of a still-live code is rejected so it cannot reset the attempt
	// counter or mail-bomb the inbox. Zero disables the cooldown.
	ResendCooldown time.Duration
}

// Execute issues and emails a code for the user. A nil Sender (no mailer wired)
// is a no-op so a mail-less deployment doesn't error on register. A resend
// inside the cooldown window of a live code returns ErrResendTooSoon without
// re-issuing, so the existing code's attempt budget is preserved.
func (uc *SendEmailVerification) Execute(ctx context.Context, userID user.ID, to, locale string) error {
	if uc.Sender == nil {
		return nil
	}
	now := uc.Clock.Now()
	if uc.ResendCooldown > 0 {
		existing, err := uc.Verifications.Get(ctx, userID)
		switch {
		case errors.Is(err, domain.ErrNotFound):
			// No live code: fall through and issue one.
		case err != nil:
			return err
		case !existing.Expired(now) && now.Sub(existing.CreatedAt) < uc.ResendCooldown:
			return ErrResendTooSoon
		}
	}
	code, err := generateOTP()
	if err != nil {
		return fmt.Errorf("generate code: %w", err)
	}
	rec := user.EmailVerification{
		UserID:    userID,
		CodeHash:  uc.HMAC.HashString(code),
		ExpiresAt: now.Add(uc.ttl()),
		CreatedAt: now,
	}
	if err := uc.Verifications.Upsert(ctx, rec); err != nil {
		return fmt.Errorf("store verification: %w", err)
	}
	return uc.Sender.SendVerificationCode(ctx, to, locale, code, uc.ttl())
}

// ClearCode removes any pending verification code for a user, used when the
// account is already verified so a stale code can't be replayed.
func (uc *SendEmailVerification) ClearCode(ctx context.Context, userID user.ID) error {
	return uc.Verifications.Delete(ctx, userID)
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
// already-verified account returns nil. Each call atomically consumes one
// attempt against a live code, so concurrent guesses cannot overspend the
// budget; expired or exhausted codes are reported (and an expired one cleared).
func (uc *VerifyEmail) Execute(ctx context.Context, userID user.ID, code string) error {
	u, err := uc.Users.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if u.EmailVerified {
		// Clear any code that lingered (e.g. a resend that raced a verify) so a
		// verified account never keeps a live OTP row.
		_ = uc.Verifications.Delete(ctx, userID)
		return nil
	}

	now := uc.Clock.Now()
	codeHash, ok, err := uc.Verifications.RegisterAttempt(ctx, userID, user.MaxVerificationAttempts, now)
	if err != nil {
		return err
	}
	if !ok {
		return uc.classifyNoAttempt(ctx, userID, now)
	}
	if !uc.HMAC.Equal(codeHash, uc.HMAC.HashString(code)) {
		return ErrVerificationInvalid
	}

	if err := uc.Users.MarkEmailVerified(ctx, userID, now); err != nil {
		return fmt.Errorf("mark verified: %w", err)
	}
	_ = uc.Verifications.Delete(ctx, userID)
	return nil
}

// classifyNoAttempt explains why no attempt could be registered: no pending
// code, an expired one (cleared here), or an exhausted budget.
func (uc *VerifyEmail) classifyNoAttempt(ctx context.Context, userID user.ID, now time.Time) error {
	rec, err := uc.Verifications.Get(ctx, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return ErrNoVerificationPending
	}
	if err != nil {
		return err
	}
	if rec.Expired(now) {
		_ = uc.Verifications.Delete(ctx, userID)
		return ErrVerificationExpired
	}
	return ErrVerificationAttempts
}

// generateOTP returns a uniform 6-digit numeric code.
func generateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
