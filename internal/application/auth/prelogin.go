package auth

import (
	"context"
	"errors"
	"strings"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// PreloginInput is the GET /auth/prelogin request.
type PreloginInput struct {
	Email string
}

// PreloginOutput carries the KDF parameters the client needs to derive the
// master key. For unknown emails, Salt is a deterministic HMAC of the
// normalised email under VAULTCTL_ENUMERATION_PEPPER (H2), and the KDF
// params are the server defaults.
type PreloginOutput struct {
	Salt        []byte
	Iterations  uint32
	MemoryKB    uint32
	Parallelism uint8
}

// Prelogin is the KDF-parameter lookup use case.
type Prelogin struct {
	Users      ports.UserRepository
	HMAC       ports.HMACer
	DefaultKDF user.KDFParams
}

// Execute looks up the user by email and returns their KDF params. For any
// lookup miss — malformed email OR unknown email — returns a deterministic
// fake salt with identical response shape so an attacker cannot distinguish
// registered from unregistered accounts (H2).
func (uc *Prelogin) Execute(ctx context.Context, in PreloginInput) (PreloginOutput, error) {
	defaults := uc.DefaultKDF
	if defaults.Iterations == 0 {
		defaults = user.DefaultKDFParams()
	}

	email, err := user.NewEmail(in.Email)
	if err != nil {
		// Malformed email still produces a deterministic fake salt based
		// on the raw lower-cased input so response timing stays uniform.
		salt := uc.HMAC.EnumerationSalt(strings.ToLower(strings.TrimSpace(in.Email)))
		return buildOutput(salt, defaults), nil
	}

	u, err := uc.Users.FindByEmail(ctx, email)
	switch {
	case err == nil:
		return buildOutput(u.Salt, u.KDFParams), nil
	case errors.Is(err, domain.ErrNotFound):
		return buildOutput(uc.HMAC.EnumerationSalt(email.String()), defaults), nil
	default:
		return PreloginOutput{}, err
	}
}

func buildOutput(salt []byte, p user.KDFParams) PreloginOutput {
	if p.Iterations == 0 {
		p = user.DefaultKDFParams()
	}
	return PreloginOutput{
		Salt:        salt,
		Iterations:  p.Iterations,
		MemoryKB:    p.MemoryKB,
		Parallelism: p.Parallelism,
	}
}
