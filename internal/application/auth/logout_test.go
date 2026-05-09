// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func TestLogout_RevokesSession(t *testing.T) {
	t.Parallel()
	sess := newFakeSessionStore()
	repo := newFakeUserRepo()
	uc := &Logout{Sessions: sess, HMAC: fakeHMAC{}}
	_ = seedSession(t, repo, sess, "rtok-1", time.Unix(1_700_000_000+3600, 0).UTC())

	if _, err := uc.Execute(context.Background(), LogoutInput{RefreshToken: "rtok-1"}); err != nil {
		t.Fatalf("Execute: %v", err)
	}

	hash, _ := user.NewRefreshTokenHash(fakeHMAC{}.HashString("rtok-1"))
	if _, err := sess.FindByTokenHash(context.Background(), hash); err == nil {
		t.Fatalf("session not revoked")
	}
}

func TestLogout_Idempotent(t *testing.T) {
	t.Parallel()
	sess := newFakeSessionStore()
	uc := &Logout{Sessions: sess, HMAC: fakeHMAC{}}
	// Unknown token should not error.
	if _, err := uc.Execute(context.Background(), LogoutInput{RefreshToken: "unknown"}); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	// Empty token should not error either.
	if _, err := uc.Execute(context.Background(), LogoutInput{RefreshToken: ""}); err != nil {
		t.Fatalf("Execute: %v", err)
	}
}
