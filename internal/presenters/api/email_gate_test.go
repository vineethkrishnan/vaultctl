// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func TestBlocksMutation(t *testing.T) {
	now := time.Date(2026, 6, 12, 9, 0, 0, 0, time.UTC)
	grace := 168 * time.Hour // 7 days
	verifiedAt := now.Add(-time.Hour)

	tests := []struct {
		name      string
		u         user.User
		wantBlock bool
	}{
		{"verified, old account", user.User{EmailVerified: true, EmailVerifiedAt: &verifiedAt, CreatedAt: now.Add(-30 * 24 * time.Hour)}, false},
		{"unverified, within grace", user.User{CreatedAt: now.Add(-3 * 24 * time.Hour)}, false},
		{"unverified, exactly at grace edge", user.User{CreatedAt: now.Add(-grace)}, false},
		{"unverified, past grace", user.User{CreatedAt: now.Add(-8 * 24 * time.Hour)}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := blocksMutation(tt.u, now, grace); got != tt.wantBlock {
				t.Errorf("blocksMutation = %v, want %v", got, tt.wantBlock)
			}
		})
	}
}

func TestIsMutatingMethod(t *testing.T) {
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if !isMutatingMethod(m) {
			t.Errorf("%s should be mutating", m)
		}
	}
	for _, m := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		if isMutatingMethod(m) {
			t.Errorf("%s should not be mutating", m)
		}
	}
}
