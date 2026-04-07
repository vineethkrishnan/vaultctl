package user

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

func validHash(t *testing.T) RefreshTokenHash {
	t.Helper()
	h, err := NewRefreshTokenHash(bytes.Repeat([]byte{0xCE}, RefreshTokenHashSize))
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	return h
}

func TestNewRefreshTokenHash(t *testing.T) {
	t.Parallel()
	h := validHash(t)
	if h.IsZero() {
		t.Fatalf("non-empty hash must not IsZero")
	}
	out := h.Bytes()
	if len(out) != RefreshTokenHashSize {
		t.Fatalf("len = %d, want %d", len(out), RefreshTokenHashSize)
	}
	out[0] = 0xFF
	if h.Bytes()[0] != 0xCE {
		t.Fatalf("Bytes() returned shared slice")
	}

	for _, bad := range [][]byte{nil, {}, bytes.Repeat([]byte{0}, 31), bytes.Repeat([]byte{0}, 33)} {
		if _, err := NewRefreshTokenHash(bad); !errors.Is(err, ErrInvalidRefreshTokenHash) {
			t.Fatalf("bad len=%d: expected ErrInvalidRefreshTokenHash, got %v", len(bad), err)
		}
	}
	var zero RefreshTokenHash
	if !zero.IsZero() {
		t.Fatalf("zero hash must IsZero")
	}
}

func validSession(t *testing.T) Session {
	t.Helper()
	now := time.Unix(1_700_000_000, 0).UTC()
	return Session{
		ID:         SessionID("sess-1"),
		UserID:     ID("user-1"),
		TokenHash:  validHash(t),
		DeviceName: "laptop",
		IPAddress:  "10.0.0.0/24",
		ExpiresAt:  now.Add(7 * 24 * time.Hour),
		CreatedAt:  now,
	}
}

func TestSession_Validate_OK(t *testing.T) {
	t.Parallel()
	s := validSession(t)
	if err := s.Validate(time.Unix(1_700_000_100, 0).UTC()); err != nil {
		t.Fatalf("valid session rejected: %v", err)
	}
}

func TestSession_Validate_Invariants(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0).UTC()
	cases := []struct {
		name   string
		mutate func(*Session)
		field  string
	}{
		{"empty id", func(s *Session) { s.ID = "" }, "id"},
		{"empty user", func(s *Session) { s.UserID = "" }, "user_id"},
		{"empty hash", func(s *Session) { s.TokenHash = RefreshTokenHash{} }, "token_hash"},
		{"device too long", func(s *Session) { s.DeviceName = strings.Repeat("d", 256) }, "device_name"},
		{"no expiry", func(s *Session) { s.ExpiresAt = time.Time{} }, "expires_at"},
		{"expired already", func(s *Session) { s.ExpiresAt = now.Add(-1 * time.Hour) }, "expires_at"},
		{"expiry before creation", func(s *Session) { s.ExpiresAt = s.CreatedAt.Add(-1 * time.Second) }, "expires_at"},
	}
	for _, tc := range cases {
		s := validSession(t)
		tc.mutate(&s)
		err := s.Validate(now.Add(time.Second))
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
		var inv *domain.Invalid
		if !errors.As(err, &inv) || inv.Field != tc.field {
			t.Fatalf("%s: field=%v err=%v", tc.name, inv, err)
		}
	}
}

func TestSession_Validate_NoCreatedAt(t *testing.T) {
	// A Session loaded from DB without a CreatedAt (zero value) should
	// still validate as long as expires_at is in the future — the
	// "after created_at" check only fires when CreatedAt is set.
	t.Parallel()
	s := validSession(t)
	s.CreatedAt = time.Time{}
	if err := s.Validate(time.Unix(1_700_000_100, 0).UTC()); err != nil {
		t.Fatalf("zero CreatedAt should be allowed: %v", err)
	}
}

func TestSession_IsExpired(t *testing.T) {
	t.Parallel()
	s := validSession(t)
	before := s.ExpiresAt.Add(-1 * time.Second)
	after := s.ExpiresAt.Add(1 * time.Second)
	if s.IsExpired(before) {
		t.Fatalf("should not be expired before expiry")
	}
	if !s.IsExpired(s.ExpiresAt) {
		t.Fatalf("should be expired at expiry boundary")
	}
	if !s.IsExpired(after) {
		t.Fatalf("should be expired after expiry")
	}
}
