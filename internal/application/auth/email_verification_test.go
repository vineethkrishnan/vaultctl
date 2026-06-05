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
func (m *memVerifs) IncrementAttempts(_ context.Context, id user.ID) error {
	v := m.rec[id]
	v.Attempts++
	m.rec[id] = v
	return nil
}
func (m *memVerifs) Delete(_ context.Context, id user.ID) error {
	delete(m.rec, id)
	return nil
}

type capturingSender struct {
	to, code string
	ttl      time.Duration
}

func (s *capturingSender) SendVerificationCode(_ context.Context, to, code string, ttl time.Duration) error {
	s.to, s.code, s.ttl = to, code, ttl
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
	if err := send.Execute(context.Background(), u.ID, "alice@example.com"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if len(sender.code) != 6 {
		t.Fatalf("expected 6-digit code, got %q", sender.code)
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
