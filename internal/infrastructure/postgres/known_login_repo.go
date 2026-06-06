// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// KnownLoginRepo implements ports.KnownLoginRepository over the known_logins
// table.
type KnownLoginRepo struct{ Pool *Pool }

// Observe upserts the (fingerprint, network) row and reports novelty in one
// statement. The CTEs read the user's history from the pre-insert snapshot, and
// the upsert's RETURNING (xmax = 0) is true only when this call inserted the
// row (a racing ON CONFLICT update yields false), so a new pair alerts at most
// once even under concurrent logins.
func (r *KnownLoginRepo) Observe(ctx context.Context, userID user.ID, fingerprint []byte, network, label string, now time.Time) (ports.KnownLoginObservation, error) {
	var obs ports.KnownLoginObservation
	err := r.Pool.QueryRow(ctx, `
		WITH prior AS (
			SELECT
				EXISTS(SELECT 1 FROM known_logins WHERE user_id = $1 AND fingerprint = $2) AS device_seen,
				EXISTS(SELECT 1 FROM known_logins WHERE user_id = $1) AS any_seen
		),
		upserted AS (
			INSERT INTO known_logins (user_id, fingerprint, network, label, created_at, last_seen_at)
			VALUES ($1, $2, $3, $4, $5, $5)
			ON CONFLICT (user_id, fingerprint, network)
			DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, label = EXCLUDED.label
			RETURNING (xmax = 0) AS inserted
		)
		SELECT prior.device_seen, prior.any_seen, upserted.inserted
		FROM prior, upserted
	`, string(userID), fingerprint, network, label, now).Scan(&obs.DeviceSeen, &obs.AnySeen, &obs.Inserted)
	if err != nil {
		return ports.KnownLoginObservation{}, fmt.Errorf("observe known login: %w", err)
	}
	return obs, nil
}

// PurgeOlderThan deletes known-login rows last seen before the cutoff, bounding
// the table's growth. Returns the number of rows removed.
func (r *KnownLoginRepo) PurgeOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM known_logins WHERE last_seen_at < $1`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("purge known logins: %w", err)
	}
	return tag.RowsAffected(), nil
}
