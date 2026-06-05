// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// KnownLoginRepo implements ports.KnownLoginRepository over the known_logins
// table.
type KnownLoginRepo struct{ Pool *Pool }

// Lookup reports device/network/any-prior presence in a single round trip.
func (r *KnownLoginRepo) Lookup(ctx context.Context, userID user.ID, fingerprint []byte, network string) (deviceSeen, networkSeen, anySeen bool, err error) {
	err = r.Pool.QueryRow(ctx, `
		SELECT
			EXISTS(SELECT 1 FROM known_logins WHERE user_id = $1 AND fingerprint = $2),
			EXISTS(SELECT 1 FROM known_logins WHERE user_id = $1 AND fingerprint = $2 AND network = $3),
			EXISTS(SELECT 1 FROM known_logins WHERE user_id = $1)
	`, string(userID), fingerprint, network).Scan(&deviceSeen, &networkSeen, &anySeen)
	if err != nil {
		return false, false, false, fmt.Errorf("lookup known login: %w", err)
	}
	return deviceSeen, networkSeen, anySeen, nil
}

// Record upserts the (fingerprint, network) pair.
func (r *KnownLoginRepo) Record(ctx context.Context, userID user.ID, fingerprint []byte, network, label string, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO known_logins (user_id, fingerprint, network, label, created_at, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $5)
		ON CONFLICT (user_id, fingerprint, network)
		DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, label = EXCLUDED.label
	`, string(userID), fingerprint, network, label, now)
	if err != nil {
		return fmt.Errorf("record known login: %w", err)
	}
	return nil
}
