package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/vineethkrishnan/vaultctl/internal/application/auth"
	appvault "github.com/vineethkrishnan/vaultctl/internal/application/vault"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

// maxBodySize caps JSON request bodies at 1 MiB to prevent memory exhaustion.
const maxBodySize = 1 << 20

// ErrorBody is the standard JSON error shape.
type ErrorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Field   string `json:"field,omitempty"`
	} `json:"error"`
}

// writeError maps domain + application errors to HTTP responses. This is
// the single source of truth for status codes — handlers just call it.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	code, status, field := mapErr(err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	var body ErrorBody
	body.Error.Code = code
	body.Error.Message = err.Error()
	body.Error.Field = field
	_ = json.NewEncoder(w).Encode(body)

	// 5xx errors are interesting; log them with the request ID so operators
	// can find them. 4xx are client-driven — don't spam the log.
	if status >= 500 {
		slog.ErrorContext(r.Context(), "request.error", slog.String("code", code), slog.String("err", err.Error()))
	}
}

func mapErr(err error) (code string, status int, field string) {
	// Domain-level
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return "NOT_FOUND", http.StatusNotFound, ""
	case errors.Is(err, domain.ErrConflict):
		return "CONFLICT", http.StatusConflict, ""
	case errors.Is(err, domain.ErrForbidden):
		return "FORBIDDEN", http.StatusForbidden, ""
	}
	// Validation
	var inv *domain.Invalid
	if errors.As(err, &inv) {
		return "INVALID", http.StatusBadRequest, inv.Field
	}
	// Auth sentinels
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		return "INVALID_CREDENTIALS", http.StatusUnauthorized, ""
	case errors.Is(err, auth.ErrAccountLocked):
		return "ACCOUNT_LOCKED", http.StatusLocked, ""
	case errors.Is(err, auth.ErrEmailTaken):
		return "CONFLICT", http.StatusConflict, "email"
	case errors.Is(err, auth.ErrWeakMasterPassword):
		return "WEAK_MASTER_PASSWORD", http.StatusBadRequest, "master_password"
	case errors.Is(err, auth.ErrSessionExpired):
		return "SESSION_EXPIRED", http.StatusUnauthorized, ""
	case errors.Is(err, auth.ErrStepUpRequired):
		return "STEP_UP_REQUIRED", http.StatusForbidden, ""
	case errors.Is(err, auth.ErrAPIKeyInvalid):
		return "API_KEY_INVALID", http.StatusUnauthorized, ""
	case errors.Is(err, auth.ErrAPIKeyExpired):
		return "API_KEY_EXPIRED", http.StatusUnauthorized, ""
	case errors.Is(err, auth.ErrInviteNotRedeemable):
		return "INVITE_NOT_REDEEMABLE", http.StatusBadRequest, "token"
	}
	// Vault authorization
	switch {
	case errors.Is(err, appvault.ErrNotMember):
		// Map to 404 — don't leak "vault exists but you can't see it".
		return "NOT_FOUND", http.StatusNotFound, ""
	case errors.Is(err, appvault.ErrInsufficientRole):
		return "FORBIDDEN", http.StatusForbidden, ""
	}
	// Unknown -> 500
	return "INTERNAL", http.StatusInternalServerError, ""
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func readJSON(r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxBodySize)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return &domain.Invalid{Field: "body", Message: "request body too large"}
		}
		return err
	}
	// Reject trailing junk — ensures exactly one JSON value.
	if _, err := io.ReadAll(r.Body); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return &domain.Invalid{Field: "body", Message: "request body too large"}
		}
	}
	return nil
}
