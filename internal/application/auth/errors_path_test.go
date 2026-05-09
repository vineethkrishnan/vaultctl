// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// These tests push the infra-error paths of every use case so the 90%
// application-coverage target from architecture §M2 AC is met.

func TestLogin_PersistSessionFails(t *testing.T) {
	t.Parallel()
	uc, repo, sess, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	sess.failOps["Create"] = errors.New("db down")

	_, err := uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("authhash")})
	if err == nil || !strings.Contains(err.Error(), "persist session") {
		t.Fatalf("expected persist session wrapping, got %v", err)
	}
}

// A custom repo that surfaces a transient error from specific methods.
type erroringRepo struct {
	*fakeUserRepo
	failApplyFailedLogin bool
	failResetFailures    bool
	failFindByID         bool
	failAuthHash         bool
}

func (e *erroringRepo) ApplyFailedLogin(ctx context.Context, id user.ID, attempts int, lockedUntil *time.Time) error {
	if e.failApplyFailedLogin {
		return errors.New("apply-failed")
	}
	return e.fakeUserRepo.ApplyFailedLogin(ctx, id, attempts, lockedUntil)
}
func (e *erroringRepo) ResetLoginFailures(ctx context.Context, id user.ID) error {
	if e.failResetFailures {
		return errors.New("reset-failed")
	}
	return e.fakeUserRepo.ResetLoginFailures(ctx, id)
}
func (e *erroringRepo) FindByID(ctx context.Context, id user.ID) (user.User, error) {
	if e.failFindByID {
		return user.User{}, errors.New("find-by-id-failed")
	}
	return e.fakeUserRepo.FindByID(ctx, id)
}
func (e *erroringRepo) UpdateProfile(ctx context.Context, id user.ID, name string) error {
	return e.fakeUserRepo.UpdateProfile(ctx, id, name)
}
func (e *erroringRepo) AuthHash(ctx context.Context, id user.ID) (string, error) {
	if e.failAuthHash {
		return "", errors.New("authhash-load-failed")
	}
	return e.fakeUserRepo.AuthHash(ctx, id)
}

func TestLogin_AuthHashLoadFails(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	uc.Users = &erroringRepo{fakeUserRepo: repo, failAuthHash: true}

	_, err := uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("x")})
	if err == nil || !strings.Contains(err.Error(), "load auth hash") {
		t.Fatalf("expected load auth hash wrapping, got %v", err)
	}
}

func TestLogin_ApplyFailedLoginErr(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	uc.Users = &erroringRepo{fakeUserRepo: repo, failApplyFailedLogin: true}

	_, err := uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("WRONG")})
	if err == nil || !strings.Contains(err.Error(), "record failed login") {
		t.Fatalf("expected record failed login wrapping, got %v", err)
	}
}

func TestLogin_ResetLoginFailuresErr(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	uc.Users = &erroringRepo{fakeUserRepo: repo, failResetFailures: true}

	_, err := uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("authhash")})
	if err == nil || !strings.Contains(err.Error(), "reset login failures") {
		t.Fatalf("expected reset failures wrapping, got %v", err)
	}
}

func TestRefresh_UserNotFound(t *testing.T) {
	t.Parallel()
	uc, repo, sess := newRefresh(t)
	seedSession(t, repo, sess, "rtok-old", time.Unix(1_700_000_000+3600, 0).UTC())
	uc.Users = &erroringRepo{fakeUserRepo: repo, failFindByID: true}

	_, err := uc.Execute(context.Background(), RefreshInput{RefreshToken: "rtok-old"})
	if err == nil || !strings.Contains(err.Error(), "load user") {
		t.Fatalf("expected load user wrapping, got %v", err)
	}
}

func TestRefresh_TokenGenFailure(t *testing.T) {
	t.Parallel()
	uc, repo, sess := newRefresh(t)
	seedSession(t, repo, sess, "rtok-old", time.Unix(1_700_000_000+3600, 0).UTC())
	uc.TokenGenerator = &fakeTokenGen{fail: true}
	_, err := uc.Execute(context.Background(), RefreshInput{RefreshToken: "rtok-old"})
	if err == nil || !strings.Contains(err.Error(), "gen refresh token") {
		t.Fatalf("expected gen refresh wrapping, got %v", err)
	}
}

func TestRefresh_TokenIssueFailure(t *testing.T) {
	t.Parallel()
	uc, repo, sess := newRefresh(t)
	seedSession(t, repo, sess, "rtok-old", time.Unix(1_700_000_000+3600, 0).UTC())
	uc.Tokens = &fakeTokenIssuer{fail: true}
	_, err := uc.Execute(context.Background(), RefreshInput{RefreshToken: "rtok-old"})
	if err == nil || !strings.Contains(err.Error(), "issue access token") {
		t.Fatalf("expected issue wrapping, got %v", err)
	}
}

// sessionRotateFail wraps the fake session store to fail Rotate.
type sessionRotateFail struct {
	*fakeSessionStore
}

func (s *sessionRotateFail) Rotate(_ context.Context, _ user.SessionID, _ user.RefreshTokenHash, _ time.Time, _ time.Time) error {
	return errors.New("rotate-down")
}

func TestRefresh_RotateFailure(t *testing.T) {
	t.Parallel()
	uc, repo, sess := newRefresh(t)
	seedSession(t, repo, sess, "rtok-old", time.Unix(1_700_000_000+3600, 0).UTC())
	uc.Sessions = &sessionRotateFail{fakeSessionStore: sess}
	_, err := uc.Execute(context.Background(), RefreshInput{RefreshToken: "rtok-old"})
	if err == nil || !strings.Contains(err.Error(), "rotate refresh") {
		t.Fatalf("expected rotate wrapping, got %v", err)
	}
}

// sessionFindErr wraps the fake session store to return a non-404 on Find.
type sessionFindErr struct {
	*fakeSessionStore
}

func (s *sessionFindErr) FindByTokenHash(_ context.Context, _ user.RefreshTokenHash) (user.Session, error) {
	return user.Session{}, errors.New("db down")
}

func TestLogout_SessionLookupErr(t *testing.T) {
	t.Parallel()
	sess := newFakeSessionStore()
	uc := &Logout{Sessions: &sessionFindErr{fakeSessionStore: sess}, HMAC: fakeHMAC{}}
	_, err := uc.Execute(context.Background(), LogoutInput{RefreshToken: "token"})
	if err == nil || !strings.Contains(err.Error(), "load session") {
		t.Fatalf("expected load session wrapping, got %v", err)
	}
}

func TestRefresh_SessionLookupErr(t *testing.T) {
	t.Parallel()
	uc, _, _ := newRefresh(t)
	uc.Sessions = &sessionFindErr{fakeSessionStore: newFakeSessionStore()}
	_, err := uc.Execute(context.Background(), RefreshInput{RefreshToken: "token"})
	if err == nil || !strings.Contains(err.Error(), "load session") {
		t.Fatalf("expected load session wrapping, got %v", err)
	}
	_ = domain.ErrNotFound
}

// userRepoFindErr wraps the fake user repo to fail FindByEmail with a non-404 error.
type userRepoFindErr struct {
	*fakeUserRepo
}

func (r *userRepoFindErr) FindByEmail(_ context.Context, _ user.Email) (user.User, error) {
	return user.User{}, errors.New("db down")
}

func TestPrelogin_RepoErr(t *testing.T) {
	t.Parallel()
	uc := &Prelogin{Users: &userRepoFindErr{fakeUserRepo: newFakeUserRepo()}, HMAC: fakeHMAC{}}
	_, err := uc.Execute(context.Background(), PreloginInput{Email: "alice@example.com"})
	if err == nil {
		t.Fatalf("expected infra error bubbling")
	}
}
