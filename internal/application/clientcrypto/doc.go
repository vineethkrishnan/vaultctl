// SPDX-License-Identifier: AGPL-3.0-or-later

// Package clientcrypto contains the CLI-side cryptographic helpers that
// mirror the M6 TypeScript module in web/src/shared/crypto/. vaultctl is a
// zero-knowledge system: every sensitive byte leaving the CLI towards the
// server has been encrypted here, and every decrypted item coming back from
// the server has been opened here.
//
// Wire formats and algorithm IDs are authoritative in
// internal/domain/crypto. This package is an application-layer adapter that
// is allowed to import golang.org/x/crypto and crypto/* stdlib packages,
// whereas the domain package stays primitive-free.
//
// The package has no server-side use. It is consumed exclusively by
// internal/presenters/cli.
package clientcrypto
