// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/auditlog"
)

// AuditRepo implements ports.AuditLogRepository. One INSERT per call —
// the audit layer is deliberately single-table and allocation-light.
type AuditRepo struct{ Pool *Pool }

// Write inserts one audit_logs row. Zero-valued optional fields are
// translated to SQL NULL.
func (r *AuditRepo) Write(ctx context.Context, entry auditlog.Entry) error {
	if entry.Action == "" {
		return fmt.Errorf("audit_logs: action required")
	}

	// Translate optional fields to *string so pgx writes SQL NULL.
	var (
		userID       = nilIfEmpty(entry.UserID)
		resourceType = nilIfEmpty(entry.ResourceType)
		resourceID   = nilIfEmpty(entry.ResourceID)
		ipAddress    = nilIfEmpty(entry.IPAddress)
		userAgent    = nilIfEmpty(entry.UserAgent)
	)

	_, err := r.Pool.Exec(ctx, `
		INSERT INTO audit_logs (
			user_id, action, resource_type, resource_id,
			ip_address, user_agent, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, userID, entry.Action, resourceType, resourceID,
		ipAddress, userAgent, entry.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert audit_logs: %w", err)
	}
	return nil
}

// nilIfEmpty converts "" to nil so pgx emits SQL NULL. pgx understands
// untyped nil here because the column types are declared in the INSERT.
func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ListForUser implements ports.AuditLogReader. INET is cast to text so it
// scans into a plain string; NULL optional columns become "".
func (r *AuditRepo) ListForUser(ctx context.Context, userID string, actions []string, after time.Time, limit int) ([]auditlog.Entry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var afterArg any
	if !after.IsZero() {
		afterArg = after
	}
	rows, err := r.Pool.Query(ctx, `
		SELECT id, action, resource_type, resource_id,
		       ip_address::text, user_agent, created_at
		FROM audit_logs
		WHERE user_id = $1
		  AND ($2::timestamptz IS NULL OR created_at > $2)
		  AND (cardinality($3::text[]) = 0 OR action = ANY($3))
		ORDER BY created_at DESC
		LIMIT $4
	`, userID, afterArg, actions, limit)
	if err != nil {
		return nil, fmt.Errorf("query audit_logs: %w", err)
	}
	defer rows.Close()

	var entries []auditlog.Entry
	for rows.Next() {
		var (
			id           string
			action       string
			resourceType *string
			resourceID   *string
			ipAddress    *string
			userAgent    *string
			createdAt    time.Time
		)
		if err := rows.Scan(&id, &action, &resourceType, &resourceID, &ipAddress, &userAgent, &createdAt); err != nil {
			return nil, fmt.Errorf("scan audit_logs: %w", err)
		}
		entries = append(entries, auditlog.Entry{
			ID:           id,
			UserID:       userID,
			Action:       action,
			ResourceType: deref(resourceType),
			ResourceID:   deref(resourceID),
			IPAddress:    deref(ipAddress),
			UserAgent:    deref(userAgent),
			CreatedAt:    createdAt,
		})
	}
	return entries, rows.Err()
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
