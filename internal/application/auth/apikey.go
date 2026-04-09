package auth

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// ===========================================================================
// Errors
// ===========================================================================

// ErrAPIKeyExpired signals that a structurally valid key has passed its TTL.
var ErrAPIKeyExpired = errors.New("auth: api key expired")

// ErrAPIKeyInvalid signals that no key matches the presented hash.
var ErrAPIKeyInvalid = errors.New("auth: invalid api key")

// ===========================================================================
// CreateAPIKey
// ===========================================================================

// CreateAPIKeyInput carries the caller-supplied parameters for key creation.
type CreateAPIKeyInput struct {
	Caller    user.ID
	Name      string
	ExpiresIn *time.Duration // nil = never expires
}

// CreateAPIKeyOutput is returned exactly once — the raw key is never stored.
type CreateAPIKeyOutput struct {
	KeyID     string
	Name      string
	RawKey    string // shown only once
	KeyPrefix string
	ExpiresAt *time.Time
}

// CreateAPIKey is the use case for issuing a new personal API key.
type CreateAPIKey struct {
	APIKeys        ports.APIKeyRepository
	TokenGenerator ports.TokenGenerator
	HMAC           ports.HMACer
	Clock          ports.Clock
	IDs            ports.IDGenerator
}

// Execute generates a random key, HMAC-hashes it for storage, persists the
// row, and returns the raw key exactly once.
func (uc *CreateAPIKey) Execute(ctx context.Context, in CreateAPIKeyInput) (CreateAPIKeyOutput, error) {
	if in.Name == "" {
		return CreateAPIKeyOutput{}, domain.NewInvalid("name", "required")
	}

	rawKey, err := uc.TokenGenerator.APIKey()
	if err != nil {
		return CreateAPIKeyOutput{}, fmt.Errorf("generate api key: %w", err)
	}

	keyHash := hex.EncodeToString(uc.HMAC.HashString(rawKey))

	// Store first 8 chars of the raw key for identification
	prefix := rawKey
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}

	now := uc.Clock.Now()
	var expiresAt *time.Time
	if in.ExpiresIn != nil {
		t := now.Add(*in.ExpiresIn)
		expiresAt = &t
	}

	key := user.APIKey{
		ID:        user.APIKeyID(uc.IDs.NewID()),
		UserID:    in.Caller,
		Name:      in.Name,
		KeyHash:   keyHash,
		KeyPrefix: prefix,
		ExpiresAt: expiresAt,
		CreatedAt: now,
	}
	if err := uc.APIKeys.Create(ctx, key); err != nil {
		return CreateAPIKeyOutput{}, fmt.Errorf("persist api key: %w", err)
	}

	return CreateAPIKeyOutput{
		KeyID:     string(key.ID),
		Name:      key.Name,
		RawKey:    rawKey,
		KeyPrefix: prefix,
		ExpiresAt: expiresAt,
	}, nil
}

// ===========================================================================
// ListAPIKeys
// ===========================================================================

// ListAPIKeysInput identifies the caller whose keys should be listed.
type ListAPIKeysInput struct {
	Caller user.ID
}

// ListAPIKeys returns all API keys for a user (without hashes).
type ListAPIKeys struct {
	APIKeys ports.APIKeyRepository
}

// Execute returns the caller's API keys.
func (uc *ListAPIKeys) Execute(ctx context.Context, in ListAPIKeysInput) ([]user.APIKey, error) {
	return uc.APIKeys.ListByUser(ctx, in.Caller)
}

// ===========================================================================
// DeleteAPIKey
// ===========================================================================

// DeleteAPIKeyInput identifies the key to delete, scoped to the caller.
type DeleteAPIKeyInput struct {
	Caller user.ID
	KeyID  user.APIKeyID
}

// DeleteAPIKey removes an API key. Hard delete, scoped to the caller's user.
type DeleteAPIKey struct {
	APIKeys ports.APIKeyRepository
}

// Execute deletes the key or returns ErrNotFound.
func (uc *DeleteAPIKey) Execute(ctx context.Context, in DeleteAPIKeyInput) error {
	return uc.APIKeys.Delete(ctx, in.Caller, in.KeyID)
}

// ===========================================================================
// ValidateAPIKey
// ===========================================================================

// ValidateAPIKeyInput carries the raw key presented by a client.
type ValidateAPIKeyInput struct {
	RawKey string
}

// ValidateAPIKeyOutput is returned on successful validation.
type ValidateAPIKeyOutput struct {
	UserID user.ID
	KeyID  user.APIKeyID
}

// ValidateAPIKey verifies a raw API key against stored HMAC hashes. Used
// internally by middleware, not exposed as an HTTP handler.
type ValidateAPIKey struct {
	APIKeys ports.APIKeyRepository
	HMAC    ports.HMACer
	Clock   ports.Clock
}

// Execute HMAC-hashes the raw key, looks it up, checks expiry, and touches
// last_used_at.
func (uc *ValidateAPIKey) Execute(ctx context.Context, in ValidateAPIKeyInput) (ValidateAPIKeyOutput, error) {
	if in.RawKey == "" {
		return ValidateAPIKeyOutput{}, ErrAPIKeyInvalid
	}

	keyHash := hex.EncodeToString(uc.HMAC.HashString(in.RawKey))

	key, err := uc.APIKeys.GetByHash(ctx, keyHash)
	if errors.Is(err, domain.ErrNotFound) {
		return ValidateAPIKeyOutput{}, ErrAPIKeyInvalid
	}
	if err != nil {
		return ValidateAPIKeyOutput{}, fmt.Errorf("lookup api key: %w", err)
	}

	now := uc.Clock.Now()
	if key.IsExpired(now) {
		return ValidateAPIKeyOutput{}, ErrAPIKeyExpired
	}

	// Best-effort last_used_at touch — don't fail the request if it errors.
	_ = uc.APIKeys.UpdateLastUsed(ctx, key.ID, now)

	return ValidateAPIKeyOutput{
		UserID: key.UserID,
		KeyID:  key.ID,
	}, nil
}
