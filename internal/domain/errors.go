// SPDX-License-Identifier: AGPL-3.0-or-later

package domain

import (
	"errors"
	"fmt"
)

// ErrInvalid is the sentinel for domain-invariant violations. Every domain
// subpackage wraps its own specific messages around this so that the
// application layer can do `errors.Is(err, domain.ErrInvalid)` to recognise
// any validation failure in a uniform way.
var ErrInvalid = errors.New("domain: invariant violated")

// ErrNotFound marks a domain lookup miss. Repositories in the infrastructure
// layer wrap this sentinel; use cases translate it to API 404s.
var ErrNotFound = errors.New("domain: not found")

// ErrConflict marks a constraint violation where a concrete identity already
// exists (duplicate email, duplicate membership row, etc.).
var ErrConflict = errors.New("domain: conflict")

// ErrForbidden marks an authorization failure — caller is authenticated but
// lacks the permission to perform the action.
var ErrForbidden = errors.New("domain: forbidden")

// Invalid wraps ErrInvalid with a human-readable message and optional field
// context. Field is included to let handlers surface per-field errors.
type Invalid struct {
	Field   string
	Message string
}

func (e *Invalid) Error() string {
	if e.Field == "" {
		return fmt.Sprintf("domain: %s", e.Message)
	}
	return fmt.Sprintf("domain: %s: %s", e.Field, e.Message)
}

func (e *Invalid) Unwrap() error { return ErrInvalid }

// NewInvalid is the canonical constructor for field-level validation errors.
func NewInvalid(field, message string) *Invalid {
	return &Invalid{Field: field, Message: message}
}
