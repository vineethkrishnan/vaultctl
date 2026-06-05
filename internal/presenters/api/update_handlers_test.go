// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/updatecheck"
)

func TestWithinRolloutHoldback(t *testing.T) {
	published := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	rel := updatecheck.Release{Version: "1.13.0", PublishedAt: published}

	tests := []struct {
		name    string
		current string
		delay   time.Duration
		now     time.Time
		release updatecheck.Release
		want    bool
	}{
		{"no delay reveals immediately", "1.12.0", 0, published.Add(time.Minute), rel, false},
		{"within hold-back window", "1.12.0", 48 * time.Hour, published.Add(time.Hour), rel, true},
		{"past hold-back window", "1.12.0", 48 * time.Hour, published.Add(49 * time.Hour), rel, false},
		{"no update available", "1.13.0", 48 * time.Hour, published.Add(time.Hour), rel, false},
		{"already ahead", "1.14.0", 48 * time.Hour, published.Add(time.Hour), rel, false},
		{"zero publish time", "1.12.0", 48 * time.Hour, published, updatecheck.Release{Version: "1.13.0"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &UpdateHandlers{
				CurrentVersion: tt.current,
				RolloutDelay:   tt.delay,
				Now:            func() time.Time { return tt.now },
			}
			if got := h.withinRolloutHoldback(tt.release); got != tt.want {
				t.Errorf("withinRolloutHoldback = %v, want %v", got, tt.want)
			}
		})
	}
}
