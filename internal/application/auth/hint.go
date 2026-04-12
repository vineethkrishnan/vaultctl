package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// GetPasswordHintInput is the GET /auth/password/hint request.
type GetPasswordHintInput struct {
	Email string
}

// GetPasswordHintOutput carries the decrypted (plaintext) password hint.
// Hint is empty when the user has not set one.
type GetPasswordHintOutput struct {
	Hint string
}

// GetPasswordHint retrieves and decrypts the user's password hint. This is
// a public endpoint (no auth) — the same enumeration protection as prelogin
// applies: unknown emails return an empty hint indistinguishably.
type GetPasswordHint struct {
	Users     ports.UserRepository
	Encrypter ports.DataEncrypter
}

// Execute runs the use case.
func (uc *GetPasswordHint) Execute(ctx context.Context, in GetPasswordHintInput) (GetPasswordHintOutput, error) {
	email, err := user.NewEmail(in.Email)
	if err != nil {
		// Malformed email — return empty hint, don't leak existence
		return GetPasswordHintOutput{}, nil
	}

	hint, err := uc.Users.GetHint(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return GetPasswordHintOutput{}, nil
		}
		return GetPasswordHintOutput{}, fmt.Errorf("get hint: %w", err)
	}

	if len(hint) == 0 {
		return GetPasswordHintOutput{}, nil
	}

	// Decrypt using server-side AEAD with email as AAD
	if uc.Encrypter == nil {
		return GetPasswordHintOutput{}, nil
	}

	blob, err := crypto.ParseBlob(hint)
	if err != nil {
		// Corrupted blob — treat as no hint
		return GetPasswordHintOutput{}, nil
	}

	plaintext, err := uc.Encrypter.Decrypt(blob, []byte("password_hint:"+email.String()))
	if err != nil {
		// Decryption failure — treat as no hint rather than exposing error
		return GetPasswordHintOutput{}, nil
	}

	return GetPasswordHintOutput{Hint: string(plaintext)}, nil
}
