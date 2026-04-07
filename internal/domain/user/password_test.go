package user

import (
	"errors"
	"strings"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

func TestValidateMasterPassword_DefaultPolicy(t *testing.T) {
	t.Parallel()
	policy := DefaultPolicy()

	goodCases := []string{
		"Correct-horse-battery1",
		"Alpha Bravo Charlie 42!",
		"Tr0ub4dor&3x",
	}
	for _, pw := range goodCases {
		if err := ValidateMasterPassword(pw, policy); err != nil {
			t.Fatalf("%q: expected ok, got %v", pw, err)
		}
	}

	badCases := []struct {
		pw     string
		reason string
	}{
		{"short1!", "too short"},
		{"alllowercase", "single class"},
		{"ALLUPPERCASE", "single class"},
		{"1234567890", "single class"},
		{"password", "common list"},
		{"Password1", "common after lowering (policy uses exact lowercase match)"},
	}
	// "Password1" lower-cases to "password1" which IS in our common list.
	for _, tc := range badCases {
		if err := ValidateMasterPassword(tc.pw, policy); err == nil {
			t.Fatalf("%q (%s): expected weakness error", tc.pw, tc.reason)
		} else if !errors.Is(err, ErrWeakMasterPassword) {
			t.Fatalf("%q: expected ErrWeakMasterPassword, got %v", tc.pw, err)
		}
	}
}

func TestValidateMasterPassword_MaxLength(t *testing.T) {
	t.Parallel()
	policy := DefaultPolicy()
	pw := strings.Repeat("Abcdefghij9!", 200) // well beyond 1024
	if err := ValidateMasterPassword(pw, policy); !errors.Is(err, ErrWeakMasterPassword) {
		t.Fatalf("expected length cap to trigger, got %v", err)
	}
}

func TestValidateMasterPassword_ZeroPolicyDefaults(t *testing.T) {
	t.Parallel()
	// A zero-value policy should fall back to sensible defaults so callers
	// can't accidentally configure "no check".
	zero := MasterPasswordPolicy{}
	if err := ValidateMasterPassword("x", zero); err == nil {
		t.Fatalf("zero policy should still reject 1-char password")
	}
}

func TestValidateMasterPassword_NegativeMaxLength(t *testing.T) {
	// A negative MaxLength should normalise to the default 1024 cap so a
	// short-but-strong password still passes through.
	t.Parallel()
	p := DefaultPolicy()
	p.MaxLength = -1
	if err := ValidateMasterPassword("Correct-horse-8", p); err != nil {
		t.Fatalf("negative max should normalise: %v", err)
	}
}

func TestValidateMasterPassword_DiverseDisabled(t *testing.T) {
	// When RequireDiverse is false, a single-class password passes.
	t.Parallel()
	p := MasterPasswordPolicy{MinLength: 10, MaxLength: 1024, RequireDiverse: false, BlockedCommon: map[string]struct{}{}}
	if err := ValidateMasterPassword("alllowercase", p); err != nil {
		t.Fatalf("single-class pass should succeed without diversity: %v", err)
	}
}

func TestToDomainError(t *testing.T) {
	t.Parallel()
	if ToDomainError(nil) != nil {
		t.Fatalf("nil in -> nil out")
	}
	err := ValidateMasterPassword("weak", DefaultPolicy())
	wrapped := ToDomainError(err)
	if !errors.Is(wrapped, domain.ErrInvalid) {
		t.Fatalf("expected domain.ErrInvalid chain, got %v", wrapped)
	}
	// Non-matching errors should pass through unchanged.
	other := errors.New("boom")
	if got := ToDomainError(other); got != other {
		t.Fatalf("unrelated error should pass through")
	}
}
