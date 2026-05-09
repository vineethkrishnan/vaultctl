// SPDX-License-Identifier: AGPL-3.0-or-later

// Package auth hosts the infrastructure adapters for authentication:
// Argon2id hashing, JWT signing, HMAC hashing, and TOTP. Each adapter
// implements a port defined in application/ports.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// ServerArgon2Params captures the server-side Argon2id parameters used to
// RE-HASH the client-provided authHash. This second hash is what ends up in
// users.auth_hash and is what the server compares against at login.
//
// These are SEPARATE from the client-side KDFParams on user.User — those
// drive the initial Argon2id that turns the master password into the master
// key.
type ServerArgon2Params struct {
	Iterations  uint32
	MemoryKB    uint32
	Parallelism uint8
	SaltLen     uint32
	KeyLen      uint32
}

// DefaultServerArgon2Params mirrors architecture §6.3 (OWASP 2023 recommended
// floor) for the SERVER-SIDE re-hash. It's deliberately distinct from the
// client-side default so that operators can tune server cost independently.
func DefaultServerArgon2Params() ServerArgon2Params {
	return ServerArgon2Params{
		Iterations:  2,
		MemoryKB:    19456, // 19 MiB OWASP floor
		Parallelism: 1,
		SaltLen:     16,
		KeyLen:      32,
	}
}

// Argon2Hasher is the infrastructure implementation of ports.AuthHasher.
//
// Hash encoding follows the widely-used argon2-cffi phc-string format:
//
//	$argon2id$v=19$m=<mem>,t=<iter>,p=<par>$<b64-salt>$<b64-hash>
//
// We keep the PHC form so existing tooling can inspect/verify hashes without
// a custom parser.
type Argon2Hasher struct {
	Params ServerArgon2Params
}

// NewArgon2Hasher returns a hasher using the given params (or defaults when
// zero-valued).
func NewArgon2Hasher(p ServerArgon2Params) *Argon2Hasher {
	if p.Iterations == 0 {
		p = DefaultServerArgon2Params()
	}
	if p.SaltLen == 0 {
		p.SaltLen = 16
	}
	if p.KeyLen == 0 {
		p.KeyLen = 32
	}
	return &Argon2Hasher{Params: p}
}

// Hash derives a server-side Argon2id hash of the client-provided authHash.
// The returned PHC-encoded string is stored in users.auth_hash.
func (h *Argon2Hasher) Hash(input []byte) (string, error) {
	salt := make([]byte, h.Params.SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("argon2: read salt: %w", err)
	}
	digest := argon2.IDKey(input, salt, h.Params.Iterations, h.Params.MemoryKB, h.Params.Parallelism, h.Params.KeyLen)
	return encodePHC(h.Params, salt, digest), nil
}

// ErrMalformedPHC signals that the stored hash cannot be parsed.
var ErrMalformedPHC = errors.New("argon2: malformed phc string")

// Verify performs a constant-time comparison between input and the stored
// PHC-encoded Argon2id hash. Returns true iff they match.
//
// If the stored hash was produced with weaker parameters than the current
// server defaults, upgrade=true so the caller can re-hash and persist. This
// supports seamless parameter bumps across releases.
func (h *Argon2Hasher) Verify(input []byte, encoded string) (ok, upgrade bool, err error) {
	p, salt, expected, err := decodePHC(encoded)
	if err != nil {
		return false, false, err
	}
	got := argon2.IDKey(input, salt, p.Iterations, p.MemoryKB, p.Parallelism, uint32(len(expected)))
	if subtle.ConstantTimeCompare(got, expected) != 1 {
		return false, false, nil
	}
	// Flag upgrade if any configured parameter is strictly higher than what
	// the stored hash used.
	upgrade = h.Params.Iterations > p.Iterations ||
		h.Params.MemoryKB > p.MemoryKB ||
		h.Params.Parallelism > p.Parallelism
	return true, upgrade, nil
}

// ===========================================================================
// PHC encoding helpers
// ===========================================================================

const phcPrefix = "$argon2id$v=19$"

func encodePHC(p ServerArgon2Params, salt, digest []byte) string {
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("%sm=%d,t=%d,p=%d$%s$%s",
		phcPrefix, p.MemoryKB, p.Iterations, p.Parallelism,
		b64.EncodeToString(salt), b64.EncodeToString(digest))
}

func decodePHC(encoded string) (ServerArgon2Params, []byte, []byte, error) {
	if !strings.HasPrefix(encoded, phcPrefix) {
		return ServerArgon2Params{}, nil, nil, fmt.Errorf("%w: unknown prefix", ErrMalformedPHC)
	}
	parts := strings.Split(strings.TrimPrefix(encoded, phcPrefix), "$")
	if len(parts) != 3 {
		return ServerArgon2Params{}, nil, nil, fmt.Errorf("%w: expected 3 segments", ErrMalformedPHC)
	}

	var p ServerArgon2Params
	if _, err := fmt.Sscanf(parts[0], "m=%d,t=%d,p=%d", &p.MemoryKB, &p.Iterations, &p.Parallelism); err != nil {
		return ServerArgon2Params{}, nil, nil, fmt.Errorf("%w: params: %v", ErrMalformedPHC, err) //nolint:errorlint // wrap sentinel only
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[1])
	if err != nil {
		return ServerArgon2Params{}, nil, nil, fmt.Errorf("%w: salt: %v", ErrMalformedPHC, err) //nolint:errorlint // wrap sentinel only
	}
	digest, err := b64.DecodeString(parts[2])
	if err != nil {
		return ServerArgon2Params{}, nil, nil, fmt.Errorf("%w: digest: %v", ErrMalformedPHC, err) //nolint:errorlint // wrap sentinel only
	}
	p.SaltLen = uint32(len(salt))
	p.KeyLen = uint32(len(digest))
	return p, salt, digest, nil
}
