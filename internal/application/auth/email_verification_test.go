// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

type memVerifs struct {
	rec map[user.ID]user.EmailVerification
}

func newMemVerifs() *memVerifs { return &memVerifs{rec: map[user.ID]user.EmailVerification{}} }

func (m *memVerifs) Upsert(_ context.Context, v user.EmailVerification) error {
	v.Attempts = 0
	m.rec[v.UserID] = v
	return nil
}
func (m *memVerifs) Get(_ context.Context, id user.ID) (user.EmailVerification, error) {
	v, ok := m.rec[id]
	if !ok {
		return user.EmailVerification{}, domain.ErrNotFound
	}
	return v, nil
}
func (m *memVerifs) RegisterAttempt(_ context.Context, id user.ID, maxAttempts int, now time.Time) (codeHash []byte, ok bool, err error) {
	v, exists := m.rec[id]
	if !exists || v.Expired(now) || v.Attempts >= maxAttempts {
		return nil, false, nil
	}
	v.Attempts++
	m.rec[id] = v
	return v.CodeHash, true, nil
}
func (m *memVerifs) Delete(_ context.Context, id user.ID) error {
	delete(m.rec, id)
	return nil
}

type capturingSender struct {
	to, locale, code string
	ttl              time.Duration
}

func (s *capturingSender) SendVerificationCode(_ context.Context, to, locale, code string, ttl time.Duration) error {
	s.to, s.locale, s.code, s.ttl = to, locale, code, ttl
	return nil
}

func TestSendAndVerifyEmail(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	clock := ports.ClockFunc(func() time.Time { return now })
	repo := newFakeUserRepo()
	u := seedUser(t, repo, "alice@example.com")
	verifs := newMemVerifs()
	sender := &capturingSender{}

	send := &SendEmailVerification{Verifications: verifs, HMAC: fakeHMAC{}, Clock: clock, Sender: sender, CodeTTL: 15 * time.Minute}
	if err := send.Execute(context.Background(), u.ID, "alice@example.com", "de"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if len(sender.code) != 6 {
		t.Fatalf("expected 6-digit code, got %q", sender.code)
	}
	if sender.locale != "de" {
		t.Fatalf("expected the requested locale threaded to the send, got %q", sender.locale)
	}

	verify := &VerifyEmail{Users: repo, Verifications: verifs, HMAC: fakeHMAC{}, Clock: clock}

	// Correct code verifies and clears the record.
	if err := verify.Execute(context.Background(), u.ID, sender.code); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got := repo.byID[u.ID]; !got.EmailVerified {
		t.Error("user not marked verified")
	}
	if _, ok := verifs.rec[u.ID]; ok {
		t.Error("verification record not cleared")
	}

	// Re-verifying an already-verified user is a no-op success.
	if err := verify.Execute(context.Background(), u.ID, "123456"); err != nil {
		t.Errorf("idempotent verify: %v", err)
	}
}

func TestVerifyEmail_WrongCodeIncrements(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	repo := newFakeUserRepo()
	u := seedUser(t, repo, "alice@example.com")
	verifs := newMemVerifs()
	verifs.rec[u.ID] = user.EmailVerification{
		UserID: u.ID, CodeHash: fakeHMAC{}.HashString("123456"),
		ExpiresAt: now.Add(10 * time.Minute), CreatedAt: now,
	}
	verify := &VerifyEmail{Users: repo, Verifications: verifs, HMAC: fakeHMAC{}, Clock: ports.ClockFunc(func() time.Time { return now })}
	if err := verify.Execute(context.Background(), u.ID, "999999"); !errors.Is(err, ErrVerificationInvalid) {
		t.Fatalf("expected invalid, got %v", err)
	}
	if verifs.rec[u.ID].Attempts != 1 {
		t.Errorf("attempts = %d, want 1", verifs.rec[u.ID].Attempts)
	}
}

func TestVerifyEmail_Expired(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	repo := newFakeUserRepo()
	u := seedUser(t, repo, "alice@example.com")
	verifs := newMemVerifs()
	verifs.rec[u.ID] = user.EmailVerification{
		UserID: u.ID, CodeHash: fakeHMAC{}.HashString("123456"),
		ExpiresAt: now.Add(-time.Minute), CreatedAt: now.Add(-20 * time.Minute),
	}
	verify := &VerifyEmail{Users: repo, Verifications: verifs, HMAC: fakeHMAC{}, Clock: ports.ClockFunc(func() time.Time { return now })}
	if err := verify.Execute(context.Background(), u.ID, "123456"); !errors.Is(err, ErrVerificationExpired) {
		t.Fatalf("expected expired, got %v", err)
	}
}

func TestVerifyEmail_ExhaustedAfterCap(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	repo := newFakeUserRepo()
	u := seedUser(t, repo, "alice@example.com")
	verifs := newMemVerifs()
	verifs.rec[u.ID] = user.EmailVerification{
		UserID: u.ID, CodeHash: fakeHMAC{}.HashString("123456"),
		ExpiresAt: now.Add(10 * time.Minute), CreatedAt: now,
	}
	verify := &VerifyEmail{Users: repo, Verifications: verifs, HMAC: fakeHMAC{}, Clock: ports.ClockFunc(func() time.Time { return now })}

	// Burn the whole budget with wrong guesses; each consumes exactly one slot.
	for i := 0; i < user.MaxVerificationAttempts; i++ {
		if err := verify.Execute(context.Background(), u.ID, "999999"); !errors.Is(err, ErrVerificationInvalid) {
			t.Fatalf("guess %d: expected invalid, got %v", i, err)
		}
	}
	if verifs.rec[u.ID].Attempts != user.MaxVerificationAttempts {
		t.Fatalf("attempts = %d, want %d", verifs.rec[u.ID].Attempts, user.MaxVerificationAttempts)
	}
	// The next attempt - even the CORRECT code - is rejected as exhausted.
	if err := verify.Execute(context.Background(), u.ID, "123456"); !errors.Is(err, ErrVerificationAttempts) {
		t.Fatalf("expected exhausted, got %v", err)
	}
}

func TestSendVerification_ResendCooldown(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	clock := ports.ClockFunc(func() time.Time { return now })
	verifs := newMemVerifs()
	sender := &capturingSender{}
	send := &SendEmailVerification{
		Verifications: verifs, HMAC: fakeHMAC{}, Clock: clock, Sender: sender,
		CodeTTL: 15 * time.Minute, ResendCooldown: 60 * time.Second,
	}
	const uid user.ID = "u1"

	// First send issues a code.
	if err := send.Execute(context.Background(), uid, "a@b.com", "en"); err != nil {
		t.Fatalf("first send: %v", err)
	}
	firstHash := verifs.rec[uid].CodeHash
	// Simulate one wrong guess having been recorded against the live code.
	rec := verifs.rec[uid]
	rec.Attempts = 3
	verifs.rec[uid] = rec

	// Immediate resend is rejected and must NOT reset attempts or reissue.
	if err := send.Execute(context.Background(), uid, "a@b.com", "en"); !errors.Is(err, ErrResendTooSoon) {
		t.Fatalf("expected ErrResendTooSoon, got %v", err)
	}
	if verifs.rec[uid].Attempts != 3 {
		t.Fatalf("cooldown resend reset attempts to %d", verifs.rec[uid].Attempts)
	}
	if string(verifs.rec[uid].CodeHash) != string(firstHash) {
		t.Fatal("cooldown resend reissued the code")
	}
}

func TestVerifyEmail_AlreadyVerifiedClearsRow(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	repo := newFakeUserRepo()
	u := seedUser(t, repo, "alice@example.com")
	repo.byID[u.ID].EmailVerified = true
	verifs := newMemVerifs()
	verifs.rec[u.ID] = user.EmailVerification{
		UserID: u.ID, CodeHash: fakeHMAC{}.HashString("123456"),
		ExpiresAt: now.Add(10 * time.Minute), CreatedAt: now,
	}
	verify := &VerifyEmail{Users: repo, Verifications: verifs, HMAC: fakeHMAC{}, Clock: ports.ClockFunc(func() time.Time { return now })}
	if err := verify.Execute(context.Background(), u.ID, "123456"); err != nil {
		t.Fatalf("verify already-verified: %v", err)
	}
	if _, ok := verifs.rec[u.ID]; ok {
		t.Error("lingering verification row not cleared on already-verified short-circuit")
	}
}
