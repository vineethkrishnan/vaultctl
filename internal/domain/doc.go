// SPDX-License-Identifier: AGPL-3.0-or-later

// Package domain is the innermost layer of the hexagonal architecture.
//
// It contains entities, value objects, and invariants with ZERO dependencies
// outside the Go standard library. depguard enforces this at CI time - any
// import of chi, pgx, jwt, argon2, or anything else from this tree will fail
// the lint step.
//
// Milestone M1 populates this package with vault, user, organization, and
// crypto sub-packages as specified in architecture.md §M1.
package domain
