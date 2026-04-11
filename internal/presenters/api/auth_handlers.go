package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/vineethkrishnan/vaultctl/internal/application/audit"
	"github.com/vineethkrishnan/vaultctl/internal/application/auth"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// AuthHandlers ties HTTP to the auth use cases.
type AuthHandlers struct {
	Register          *auth.Register
	Prelogin          *auth.Prelogin
	Login             *auth.Login
	Refresh           *auth.Refresh
	Logout            *auth.Logout
	StepUp            *auth.StepUp
	TOTPSetup         *auth.TOTPSetup
	TOTPEnable        *auth.TOTPEnable
	TOTPDisable       *auth.TOTPDisable
	TOTPVerify        *auth.TOTPVerify
	PasswordChange    *auth.PasswordChange
	GetPasswordHint   *auth.GetPasswordHint
	VerifyRecoveryKey *auth.VerifyRecoveryKey
	ResetViaRecovery  *auth.ResetViaRecovery

	// Users is used by HandleLogin to resolve a user ID for
	// login.failed audit rows without storing the raw email.
	Users ports.UserRepository

	// Audit is the cross-cutting audit-log writer (M13). Never nil in
	// wired production; handler tests may pass audit.NewNoop().
	Audit *audit.Writer
}

// HandleRegister creates a new user account.
// @Summary Register new user
// @Description Create a new user account with client-side derived crypto material
// @Tags Auth
// @Accept json
// @Produce json
// @Param body body RegisterRequest true "Registration payload"
// @Success 201 {object} RegisterResponse
// @Failure 400 {object} ErrorBody
// @Failure 409 {object} ErrorBody "Email already taken"
// @Failure 429 {object} ErrorBody "Rate limited"
// @Router /auth/register [post]
func (h *AuthHandlers) HandleRegister(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	authSecret, err := decodeAuthHashSecret(req.AuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer authSecret.Destroy()
	salt, err := decodeB64(req.Salt)
	if err != nil {
		writeError(w, r, err)
		return
	}
	encPriv, err := decodeB64Blob(req.EncryptedPrivateKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	encIDPriv, err := decodeB64Blob(req.EncryptedIdentityPrivateKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	pubKey, err := decodeB64PublicKey(req.PublicKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	idPub, err := decodeB64PublicKey(req.IdentityPublicKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	sig, err := decodeB64Signature(req.PublicKeySignature)
	if err != nil {
		writeError(w, r, err)
		return
	}

	var out auth.RegisterOutput
	authSecret.Open(func(authHash []byte) {
		out, err = h.Register.Execute(r.Context(), auth.RegisterInput{
			Email:                       req.Email,
			Name:                        req.Name,
			AuthHash:                    authHash,
			Salt:                        salt,
			MasterPasswordPreflight:     req.MasterPasswordPreflight,
			KDFParams:                   user.KDFParams{Iterations: req.KDFIterations, MemoryKB: req.KDFMemoryKB, Parallelism: req.KDFParallelism},
			EncryptedPrivateKey:         encPriv,
			EncryptedIdentityPrivateKey: encIDPriv,
			PublicKey:                   pubKey,
			PublicKeySignature:          sig,
			IdentityPublicKey:           idPub,
			InviteToken:                 req.InviteToken,
			PasswordHint:                req.PasswordHint,
		})
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, RegisterResponse{UserID: string(out.UserID), Role: string(out.Role)})
}

// HandlePrelogin returns KDF parameters for a given email.
// @Summary Get KDF parameters
// @Description Returns salt and KDF parameters needed to derive the auth hash client-side
// @Tags Auth
// @Produce json
// @Param email query string true "User email address"
// @Success 200 {object} PreloginResponse
// @Failure 404 {object} ErrorBody
// @Router /auth/prelogin [get]
func (h *AuthHandlers) HandlePrelogin(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("email")
	out, err := h.Prelogin.Execute(r.Context(), auth.PreloginInput{Email: email})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, PreloginResponse{
		Salt: encodeB64(out.Salt), Iterations: out.Iterations, MemoryKB: out.MemoryKB, Parallelism: out.Parallelism,
	})
}

// HandleLogin authenticates a user and returns tokens.
// @Summary Login
// @Description Authenticate with email and auth hash, returns JWT tokens and encrypted crypto material
// @Tags Auth
// @Accept json
// @Produce json
// @Param body body LoginRequest true "Login credentials"
// @Success 200 {object} LoginResponse
// @Failure 401 {object} ErrorBody "Invalid credentials"
// @Failure 423 {object} ErrorBody "Account locked"
// @Failure 429 {object} ErrorBody "Rate limited"
// @Router /auth/login [post]
func (h *AuthHandlers) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	authSecret, err := decodeAuthHashSecret(req.AuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer authSecret.Destroy()

	ip := middleware.ClientIP(r)
	userAgent := r.UserAgent()

	var out auth.LoginOutput
	authSecret.Open(func(authHash []byte) {
		out, err = h.Login.Execute(r.Context(), auth.LoginInput{
			Email: req.Email, AuthHash: authHash, DeviceName: req.DeviceName,
			IPAddress: ip,
		})
	})
	if err != nil {
		// Audit the failure BEFORE returning 401, so forensics always
		// see the event. Resolve the user ID if the email is known;
		// never store the raw email.
		h.auditLoginFailure(r, req.Email, ip, userAgent)
		writeError(w, r, err)
		return
	}
	h.Audit.LoginSuccess(r.Context(), string(out.UserID), ip, userAgent)
	vaults := make([]VaultMembershipDTO, 0, len(out.Vaults))
	for _, v := range out.Vaults {
		vaults = append(vaults, VaultMembershipDTO{
			VaultID:           string(v.VaultID),
			VaultName:         v.VaultName,
			VaultType:         string(v.VaultType),
			EncryptedVaultKey: encodeB64Blob(v.EncryptedVaultKey),
			SenderID:          string(v.SenderID),
			WrapSignature:     encodeB64(v.WrapSignature.Bytes()),
			Role:              string(v.Role),
		})
	}
	writeJSON(w, http.StatusOK, LoginResponse{
		UserID: string(out.UserID), Role: string(out.Role),
		AccessToken: out.AccessToken, RefreshToken: out.RefreshToken, SessionID: string(out.SessionID),
		RefreshExpiresAt: out.RefreshExpiresAt.UTC().Format(timeFormat),
		UpgradeAuthHash:  out.UpgradeAuthHash,

		EncryptedPrivateKey:         encodeB64Blob(out.EncryptedPrivateKey),
		EncryptedIdentityPrivateKey: encodeB64Blob(out.EncryptedIdentityPrivateKey),
		PublicKey:                   encodeB64(out.PublicKey.Bytes()),
		PublicKeySignature:          encodeB64(out.PublicKeySignature.Bytes()),
		IdentityPublicKey:           encodeB64(out.IdentityPublicKey.Bytes()),
		Vaults:                      vaults,
	})
}

// HandleRefresh rotates the token pair.
// @Summary Refresh tokens
// @Description Exchange a valid refresh token for a new access/refresh token pair
// @Tags Auth
// @Accept json
// @Produce json
// @Param body body RefreshRequest true "Refresh token"
// @Success 200 {object} RefreshResponse
// @Failure 401 {object} ErrorBody "Session expired"
// @Router /auth/refresh [post]
func (h *AuthHandlers) HandleRefresh(w http.ResponseWriter, r *http.Request) {
	var req RefreshRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	out, err := h.Refresh.Execute(r.Context(), auth.RefreshInput{RefreshToken: req.RefreshToken})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.Refreshed(r.Context(), string(out.UserID), string(out.SessionID), middleware.ClientIP(r), r.UserAgent())
	writeJSON(w, http.StatusOK, RefreshResponse{
		AccessToken: out.AccessToken, RefreshToken: out.RefreshToken,
		RefreshExpiresAt: out.RefreshExpiresAt.UTC().Format(timeFormat),
	})
}

// HandleLogout revokes the refresh token.
// @Summary Logout
// @Description Revoke the refresh token to end the session
// @Tags Auth
// @Accept json
// @Param body body LogoutRequest true "Refresh token to revoke"
// @Success 204 "No content"
// @Failure 401 {object} ErrorBody
// @Router /auth/logout [post]
func (h *AuthHandlers) HandleLogout(w http.ResponseWriter, r *http.Request) {
	var req LogoutRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	out, err := h.Logout.Execute(r.Context(), auth.LogoutInput{RefreshToken: req.RefreshToken})
	if err != nil {
		writeError(w, r, err)
		return
	}
	// Only audit when an actual session was revoked — a miss is a
	// silent idempotent no-op and not a security-interesting event.
	if out.SessionID != "" {
		h.Audit.Logout(r.Context(), string(out.UserID), string(out.SessionID), middleware.ClientIP(r), r.UserAgent())
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleStepUp re-authenticates for sensitive operations.
// @Summary Step-up authentication
// @Description Re-verify master password to get a step-up token for sensitive operations
// @Tags Auth
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body StepUpRequest true "Auth hash for re-authentication"
// @Success 200 {object} StepUpResponse
// @Failure 401 {object} ErrorBody
// @Failure 429 {object} ErrorBody
// @Router /auth/step-up [post]
func (h *AuthHandlers) HandleStepUp(w http.ResponseWriter, r *http.Request) {
	var req StepUpRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	authSecret, err := decodeAuthHashSecret(req.AuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer authSecret.Destroy()

	claims, _ := middleware.CallerClaims(r.Context())
	callerID := middleware.CallerID(r.Context())
	var out auth.StepUpOutput
	authSecret.Open(func(authHash []byte) {
		out, err = h.StepUp.Execute(r.Context(), auth.StepUpInput{
			Caller:   callerID,
			Role:     user.Role(claims.Role),
			AuthHash: authHash,
		})
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.StepUp(r.Context(), string(callerID), middleware.ClientIP(r), r.UserAgent())
	writeJSON(w, http.StatusOK, StepUpResponse{AccessToken: out.AccessToken})
}

// HandleTOTPSetup generates a new TOTP secret.
// @Summary Setup TOTP 2FA
// @Description Generate a new TOTP secret and QR code URL. Requires step-up authentication.
// @Tags Auth
// @Produce json
// @Security BearerAuth
// @Success 200 {object} TOTPSetupResponse
// @Failure 403 {object} ErrorBody "Step-up required"
// @Router /auth/totp/setup [post]
func (h *AuthHandlers) HandleTOTPSetup(w http.ResponseWriter, r *http.Request) {
	out, err := h.TOTPSetup.Execute(r.Context(), auth.TOTPSetupInput{
		Caller: middleware.CallerID(r.Context()),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, TOTPSetupResponse{Secret: out.Secret, OtpauthURL: out.OtpauthURL})
}

// HandleTOTPEnable activates TOTP 2FA.
// @Summary Enable TOTP 2FA
// @Description Verify a TOTP code to activate two-factor authentication
// @Tags Auth
// @Accept json
// @Security BearerAuth
// @Param body body TOTPCodeRequest true "TOTP verification code"
// @Success 204 "No content"
// @Failure 400 {object} ErrorBody "Invalid code"
// @Router /auth/totp/enable [post]
func (h *AuthHandlers) HandleTOTPEnable(w http.ResponseWriter, r *http.Request) {
	var req TOTPCodeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	callerID := middleware.CallerID(r.Context())
	err := h.TOTPEnable.Execute(r.Context(), auth.TOTPEnableInput{
		Caller: callerID,
		Code:   req.Code,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.TOTPEnabled(r.Context(), string(callerID), middleware.ClientIP(r), r.UserAgent())
	w.WriteHeader(http.StatusNoContent)
}

// HandleTOTPDisable deactivates TOTP 2FA.
// @Summary Disable TOTP 2FA
// @Description Deactivate two-factor authentication. Requires step-up.
// @Tags Auth
// @Security BearerAuth
// @Success 204 "No content"
// @Failure 403 {object} ErrorBody "Step-up required"
// @Router /auth/totp/disable [post]
func (h *AuthHandlers) HandleTOTPDisable(w http.ResponseWriter, r *http.Request) {
	callerID := middleware.CallerID(r.Context())
	err := h.TOTPDisable.Execute(r.Context(), auth.TOTPDisableInput{
		Caller: callerID,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.TOTPDisabled(r.Context(), string(callerID), middleware.ClientIP(r), r.UserAgent())
	w.WriteHeader(http.StatusNoContent)
}

// HandleTOTPVerify validates a TOTP code during login.
// @Summary Verify TOTP code
// @Description Validate a TOTP code during the two-factor authentication step of login
// @Tags Auth
// @Accept json
// @Security BearerAuth
// @Param body body TOTPCodeRequest true "TOTP code"
// @Success 204 "No content"
// @Failure 400 {object} ErrorBody "Invalid code"
// @Router /auth/totp/verify [post]
func (h *AuthHandlers) HandleTOTPVerify(w http.ResponseWriter, r *http.Request) {
	var req TOTPCodeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	err := h.TOTPVerify.Execute(r.Context(), auth.TOTPVerifyInput{
		Caller: middleware.CallerID(r.Context()),
		Code:   req.Code,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandlePasswordChange updates the master password.
// @Summary Change master password
// @Description Change master password and re-encrypt private keys. Requires step-up.
// @Tags Auth
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body PasswordChangeRequest true "Old and new auth hashes with re-encrypted keys"
// @Success 200 {object} PasswordChangeResponse
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody "Step-up required"
// @Router /auth/password/change [post]
func (h *AuthHandlers) HandlePasswordChange(w http.ResponseWriter, r *http.Request) {
	var req PasswordChangeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	oldSecret, err := decodeAuthHashSecret(req.OldAuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer oldSecret.Destroy()
	newSecret, err := decodeAuthHashSecret(req.NewAuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer newSecret.Destroy()
	encPriv, err := decodeB64(req.EncryptedPrivateKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	encIDPriv, err := decodeB64(req.EncryptedIdentityPrivateKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	claims, _ := middleware.CallerClaims(r.Context())
	callerID := middleware.CallerID(r.Context())
	var out auth.PasswordChangeOutput
	oldSecret.Open(func(oldHash []byte) {
		newSecret.Open(func(newHash []byte) {
			out, err = h.PasswordChange.Execute(r.Context(), auth.PasswordChangeInput{
				Caller:                      callerID,
				Role:                        user.Role(claims.Role),
				OldAuthHash:                 oldHash,
				NewAuthHash:                 newHash,
				EncryptedPrivateKey:         encPriv,
				EncryptedIdentityPrivateKey: encIDPriv,
			})
		})
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.PasswordChanged(r.Context(), string(callerID), middleware.ClientIP(r), r.UserAgent())
	writeJSON(w, http.StatusOK, PasswordChangeResponse{
		AccessToken:      out.AccessToken,
		RefreshToken:     out.RefreshToken,
		RefreshExpiresAt: out.RefreshExpiresAt.UTC().Format(timeFormat),
	})
}

// HandleGetPasswordHint returns the decrypted password hint for an email.
// @Summary Get password hint
// @Description Returns the password hint for the given email. Returns empty hint for unknown emails (enumeration-safe).
// @Tags Auth
// @Produce json
// @Param email query string true "User email address"
// @Success 200 {object} PasswordHintResponse
// @Router /auth/password/hint [get]
func (h *AuthHandlers) HandleGetPasswordHint(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("email")
	out, err := h.GetPasswordHint.Execute(r.Context(), auth.GetPasswordHintInput{Email: email})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, PasswordHintResponse{Hint: out.Hint})
}

// HandleVerifyRecoveryKey returns encrypted key material for account recovery.
// @Summary Get recovery material
// @Description Returns encrypted key material so the client can attempt decryption with its recovery key.
// @Tags Auth
// @Accept json
// @Produce json
// @Param body body RecoveryVerifyRequest true "Email to recover"
// @Success 200 {object} RecoveryVerifyResponse
// @Failure 401 {object} ErrorBody "Unknown email"
// @Failure 429 {object} ErrorBody "Rate limited"
// @Router /auth/recovery/verify [post]
func (h *AuthHandlers) HandleVerifyRecoveryKey(w http.ResponseWriter, r *http.Request) {
	var req RecoveryVerifyRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	out, err := h.VerifyRecoveryKey.Execute(r.Context(), auth.VerifyRecoveryKeyInput{Email: req.Email})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, RecoveryVerifyResponse{
		EncryptedPrivateKey:         encodeB64Blob(out.EncryptedPrivateKey),
		EncryptedIdentityPrivateKey: encodeB64Blob(out.EncryptedIdentityPrivateKey),
		Salt:                        encodeB64(out.Salt),
		Iterations:                  out.KDFParams.Iterations,
		MemoryKB:                    out.KDFParams.MemoryKB,
		Parallelism:                 out.KDFParams.Parallelism,
	})
}

// HandleResetViaRecovery resets the password via recovery key.
// @Summary Reset password via recovery
// @Description Reset password after client-side recovery key verification. Revokes all sessions and returns fresh tokens.
// @Tags Auth
// @Accept json
// @Produce json
// @Param body body RecoveryResetRequest true "New auth credentials with re-encrypted keys"
// @Success 200 {object} RecoveryResetResponse
// @Failure 400 {object} ErrorBody
// @Failure 401 {object} ErrorBody "Unknown email"
// @Failure 429 {object} ErrorBody "Rate limited"
// @Router /auth/recovery/reset [post]
func (h *AuthHandlers) HandleResetViaRecovery(w http.ResponseWriter, r *http.Request) {
	var req RecoveryResetRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	newSecret, err := decodeAuthHashSecret(req.NewAuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer newSecret.Destroy()
	encPriv, err := decodeB64(req.EncryptedPrivateKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	encIDPriv, err := decodeB64(req.EncryptedIdentityPrivateKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var out auth.ResetViaRecoveryOutput
	newSecret.Open(func(newHash []byte) {
		out, err = h.ResetViaRecovery.Execute(r.Context(), auth.ResetViaRecoveryInput{
			Email:                       req.Email,
			NewAuthHash:                 newHash,
			EncryptedPrivateKey:         encPriv,
			EncryptedIdentityPrivateKey: encIDPriv,
		})
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.RecoveryReset(r.Context(), string(out.UserID), middleware.ClientIP(r), r.UserAgent())
	writeJSON(w, http.StatusOK, RecoveryResetResponse{
		AccessToken:      out.AccessToken,
		RefreshToken:     out.RefreshToken,
		RefreshExpiresAt: out.RefreshExpiresAt.UTC().Format(timeFormat),
	})
}

// auditLoginFailure resolves the user ID for a failed login attempt
// (via email lookup) and emits the appropriate audit row. Raw emails
// are NEVER stored — only the resolved user ID, or NULL for unknown
// emails. Any error from the user lookup is treated as "unknown email"
// to avoid leaking enumeration signals into the audit log.
func (h *AuthHandlers) auditLoginFailure(r *http.Request, email, ip, userAgent string) {
	if h.Audit == nil {
		return
	}
	ctx := r.Context()
	if h.Users == nil || email == "" {
		h.Audit.LoginFailedUnknownEmail(ctx, ip, userAgent)
		return
	}
	normalised, err := user.NewEmail(email)
	if err != nil {
		h.Audit.LoginFailedUnknownEmail(ctx, ip, userAgent)
		return
	}
	found, err := h.Users.FindByEmail(ctx, normalised)
	if err != nil {
		// ErrNotFound is expected for unknown emails; anything else
		// also resolves to "unknown" so audit writes never block.
		_ = errors.Is(err, domain.ErrNotFound)
		h.Audit.LoginFailedUnknownEmail(ctx, ip, userAgent)
		return
	}
	h.Audit.LoginFailed(ctx, string(found.ID), ip, userAgent)
}

// extractLoginEmail reads the request body to pull the email field, then
// restores the body so the downstream handler can decode it normally.
func extractLoginEmail(r *http.Request) string {
	if r.Body == nil {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		return ""
	}
	// Restore the body for the handler.
	r.Body = io.NopCloser(bytes.NewReader(body))

	var partial struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(body, &partial); err != nil {
		return ""
	}
	return partial.Email
}
