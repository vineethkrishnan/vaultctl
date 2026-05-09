// SPDX-License-Identifier: AGPL-3.0-or-later

package user

import "time"

// APIKeyID is the unique identifier for an API key.
type APIKeyID string

// APIKey represents a personal API key for programmatic access.
type APIKey struct {
	ID         APIKeyID
	UserID     ID
	Name       string
	KeyHash    string
	KeyPrefix  string // first 8 chars of the raw key for identification
	LastUsedAt *time.Time
	ExpiresAt  *time.Time
	CreatedAt  time.Time
}

// IsExpired returns true if the key has an expiry and it has passed.
func (k APIKey) IsExpired(now time.Time) bool {
	if k.ExpiresAt == nil {
		return false
	}
	return now.After(*k.ExpiresAt)
}
