package postgres

import (
	"context"
	"fmt"

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
