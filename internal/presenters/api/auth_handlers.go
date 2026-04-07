package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"

	"github.com/vineethkrishnan/vaultctl/internal/application/auth"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// AuthHandlers ties HTTP to the auth use cases.
type AuthHandlers struct {
	Register *auth.Register
	Prelogin *auth.Prelogin
	Login    *auth.Login
	Refresh  *auth.Refresh
	Logout   *auth.Logout
	StepUp      *auth.StepUp
	TOTPSetup      *auth.TOTPSetup
	TOTPEnable     *auth.TOTPEnable
	TOTPDisable    *auth.TOTPDisable
	TOTPVerify     *auth.TOTPVerify
	PasswordChange *auth.PasswordChange
}

// POST /api/v1/auth/register
func (h *AuthHandlers) HandleRegister(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	authHash, err := base64.StdEncoding.DecodeString(req.AuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	salt, err := base64.StdEncoding.DecodeString(req.Salt)
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
	pubKeyRaw, err := base64.StdEncoding.DecodeString(req.PublicKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	pubKey, err := crypto.NewPublicKey(pubKeyRaw)
	if err != nil {
		writeError(w, r, err)
		return
	}
	idPubRaw, err := base64.StdEncoding.DecodeString(req.IdentityPublicKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	idPub, err := crypto.NewPublicKey(idPubRaw)
	if err != nil {
		writeError(w, r, err)
		return
	}
	sigRaw, err := base64.StdEncoding.DecodeString(req.PublicKeySignature)
	if err != nil {
		writeError(w, r, err)
		return
	}
	sig, err := crypto.NewEd25519Signature(sigRaw)
	if err != nil {
		writeError(w, r, err)
		return
	}

	out, err := h.Register.Execute(r.Context(), auth.RegisterInput{
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
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, RegisterResponse{UserID: string(out.UserID), Role: string(out.Role)})
}

// GET /api/v1/auth/prelogin?email=...
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

// POST /api/v1/auth/login
func (h *AuthHandlers) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	authHash, err := base64.StdEncoding.DecodeString(req.AuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	out, err := h.Login.Execute(r.Context(), auth.LoginInput{
		Email: req.Email, AuthHash: authHash, DeviceName: req.DeviceName,
		IPAddress: r.RemoteAddr,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
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

// POST /api/v1/auth/refresh
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
	writeJSON(w, http.StatusOK, RefreshResponse{
		AccessToken: out.AccessToken, RefreshToken: out.RefreshToken,
		RefreshExpiresAt: out.RefreshExpiresAt.UTC().Format(timeFormat),
	})
}

// POST /api/v1/auth/logout
func (h *AuthHandlers) HandleLogout(w http.ResponseWriter, r *http.Request) {
	var req LogoutRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.Logout.Execute(r.Context(), auth.LogoutInput{RefreshToken: req.RefreshToken}); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/v1/auth/step-up (requires JWT auth, no step-up)
func (h *AuthHandlers) HandleStepUp(w http.ResponseWriter, r *http.Request) {
	var req StepUpRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	authHash, err := base64.StdEncoding.DecodeString(req.AuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	claims, _ := middleware.CallerClaims(r.Context())
	out, err := h.StepUp.Execute(r.Context(), auth.StepUpInput{
		Caller:   middleware.CallerID(r.Context()),
		Role:     user.Role(claims.Role),
		AuthHash: authHash,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, StepUpResponse{AccessToken: out.AccessToken})
}

// POST /api/v1/auth/totp/setup (requires JWT + step-up)
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

// POST /api/v1/auth/totp/enable (requires JWT, verifies code)
func (h *AuthHandlers) HandleTOTPEnable(w http.ResponseWriter, r *http.Request) {
	var req TOTPCodeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	err := h.TOTPEnable.Execute(r.Context(), auth.TOTPEnableInput{
		Caller: middleware.CallerID(r.Context()),
		Code:   req.Code,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/v1/auth/totp/disable (requires JWT + step-up)
func (h *AuthHandlers) HandleTOTPDisable(w http.ResponseWriter, r *http.Request) {
	err := h.TOTPDisable.Execute(r.Context(), auth.TOTPDisableInput{
		Caller: middleware.CallerID(r.Context()),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/v1/auth/totp/verify (requires JWT, used during login 2FA step)
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

// POST /api/v1/auth/password/change (requires JWT + step-up)
func (h *AuthHandlers) HandlePasswordChange(w http.ResponseWriter, r *http.Request) {
	var req PasswordChangeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	oldHash, err := base64.StdEncoding.DecodeString(req.OldAuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	newHash, err := base64.StdEncoding.DecodeString(req.NewAuthHash)
	if err != nil {
		writeError(w, r, err)
		return
	}
	encPriv, err := base64.StdEncoding.DecodeString(req.EncryptedPrivateKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	encIDPriv, err := base64.StdEncoding.DecodeString(req.EncryptedIdentityPrivateKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	claims, _ := middleware.CallerClaims(r.Context())
	out, err := h.PasswordChange.Execute(r.Context(), auth.PasswordChangeInput{
		Caller:                      middleware.CallerID(r.Context()),
		Role:                        user.Role(claims.Role),
		OldAuthHash:                 oldHash,
		NewAuthHash:                 newHash,
		EncryptedPrivateKey:         encPriv,
		EncryptedIdentityPrivateKey: encIDPriv,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, PasswordChangeResponse{
		AccessToken:      out.AccessToken,
		RefreshToken:     out.RefreshToken,
		RefreshExpiresAt: out.RefreshExpiresAt.UTC().Format(timeFormat),
	})
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
