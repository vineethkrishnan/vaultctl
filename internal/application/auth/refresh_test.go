// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func newRefresh(t *testing.T) (*Refresh, *fakeUserRepo, *fakeSessionStore) {
	t.Helper()
	repo := newFakeUserRepo()
	sess := newFakeSessionStore()
	return &Refresh{
		Users:          repo,
		Sessions:       sess,
		Tokens:         &fakeTokenIssuer{},
		TokenGenerator: &fakeTokenGen{refresh: []string{"rtok-new"}},
		HMAC:           fakeHMAC{},
		Clock:          &frozenClock{t: time.Unix(1_700_000_000, 0).UTC()},
		RefreshTTL:     7 * 24 * time.Hour,
	}, repo, sess
}

func seedSession(t *testing.T, repo *fakeUserRepo, sess *fakeSessionStore, rawToken string, expiresAt time.Time) user.Session {
	t.Helper()
	seedUser(t, repo, "alice@example.com")

	hash, err := user.NewRefreshTokenHash(fakeHMAC{}.HashString(rawToken))
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	s := user.Session{
		ID:        user.SessionID("s-1"),
		UserID:    user.ID("u1"),
		TokenHash: hash,
		ExpiresAt: expiresAt,
		CreatedAt: time.Unix(1_700_000_000, 0).UTC(),
	}
	if err := sess.Create(context.Background(), s); err != nil {
		t.Fatalf("seed session: %v", err)
	}
	return s
}

func TestRefresh_HappyPath_RotatesToken(t *testing.T) {
	t.Parallel()
	uc, repo, sess := newRefresh(t)
	seeded := seedSession(t, repo, sess, "rtok-old", time.Unix(1_700_000_000+3600, 0).UTC())

	out, err := uc.Execute(context.Background(), RefreshInput{RefreshToken: "rtok-old"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if out.AccessToken == "" || out.RefreshToken == "" {
		t.Fatalf("empty tokens: %+v", out)
	}
	if out.RefreshToken == "rtok-old" {
		t.Fatalf("refresh token must rotate")
	}

	// OLD token should no longer resolve a session.
	oldHash, _ := user.NewRefreshTokenHash(fakeHMAC{}.HashString("rtok-old"))
	if _, err := sess.FindByTokenHash(context.Background(), oldHash); err == nil {
		t.Fatalf("old refresh token still maps to a session - rotation broken")
	}

	// NEW token resolves to the same session id.
	newHash, _ := user.NewRefreshTokenHash(fakeHMAC{}.HashString(out.RefreshToken))
	found, err := sess.FindByTokenHash(context.Background(), newHash)
	if err != nil {
		t.Fatalf("new token lookup: %v", err)
	}
	if found.ID != seeded.ID {
		t.Fatalf("rotation recreated session: %v vs %v", found.ID, seeded.ID)
	}
	if found.LastRefreshAt == nil {
		t.Fatalf("Rotate did not touch LastRefreshAt")
	}
}

func TestRefresh_UnknownToken(t *testing.T) {
	t.Parallel()
	uc, _, _ := newRefresh(t)
	_, err := uc.Execute(context.Background(), RefreshInput{RefreshToken: "bogus"})
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestRefresh_Expired(t *testing.T) {
	t.Parallel()
	uc, repo, sess := newRefresh(t)
	past := time.Unix(1_600_000_000, 0).UTC()
	seedSession(t, repo, sess, "rtok-old", past)

	_, err := uc.Execute(context.Background(), RefreshInput{RefreshToken: "rtok-old"})
	if !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("expected ErrSessionExpired, got %v", err)
	}
	// Session should be cleaned up.
	oldHash, _ := user.NewRefreshTokenHash(fakeHMAC{}.HashString("rtok-old"))
	if _, err := sess.FindByTokenHash(context.Background(), oldHash); err == nil {
		t.Fatalf("expired session should be revoked")
	}
}
