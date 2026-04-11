package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	httpSwagger "github.com/swaggo/http-swagger/v2"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"

	_ "github.com/vineethkrishnan/vaultctl/docs" // swagger generated docs
)

// Dependencies bundles the wired services the router needs.
type Dependencies struct {
	Tokens             ports.TokenIssuer
	Clock              ports.Clock
	Auth               *AuthHandlers
	User               *UserHandlers
	Vault              *VaultHandlers
	APIKey             *APIKeyHandlers
	Invite             *InviteHandlers
	Org                *OrgHandlers
	Admin              *AdminHandlers
	Export             *ExportHandlers
	Import             *ImportHandlers
	APIKeyValidator    middleware.APIKeyValidator
	RateLimiter        *middleware.RateLimiter
	CORSAllowedOrigins []string
	RegistrationMode   string
	Env                string
}

// NewRouter assembles the chi router with the full middleware stack and
// every endpoint from PRD §10.
func NewRouter(deps Dependencies) http.Handler {
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(60 * time.Second))
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.CORS(deps.CORSAllowedOrigins))

	requireAuth := middleware.RequireJWTOrAPIKey(deps.Tokens, deps.APIKeyValidator)
	requireStepUp := middleware.RequireStepUp(deps.Clock)
	requireAdmin := middleware.RequireRole(user.RoleAdmin)

	if deps.Env != "production" {
		r.Get("/swagger/*", httpSwagger.Handler(
			httpSwagger.URL("/swagger/doc.json"),
		))
	}

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", healthHandler)
		r.Get("/config", configHandler(deps.RegistrationMode))

		// ===== Auth (unauthenticated) =====
		r.Group(func(r chi.Router) {
			if deps.RateLimiter != nil {
				// Per-IP + per-email rate limiting on credential endpoints (H3)
				r.Use(deps.RateLimiter.AuthAttempt(extractLoginEmail))
			}
			r.Post("/auth/register", deps.Auth.HandleRegister)
			r.Get("/auth/prelogin", deps.Auth.HandlePrelogin)
			r.Get("/auth/password/hint", deps.Auth.HandleGetPasswordHint)
			r.Post("/auth/login", deps.Auth.HandleLogin)
			r.Post("/auth/refresh", deps.Auth.HandleRefresh)
			r.Post("/auth/logout", deps.Auth.HandleLogout)
			r.Post("/auth/recovery/verify", deps.Auth.HandleVerifyRecoveryKey)
			r.Post("/auth/recovery/reset", deps.Auth.HandleResetViaRecovery)

			// Invite redemption is public — new users redeem before registering
			r.Post("/auth/invites/redeem", deps.Invite.HandleRedeemInvite)
		})

		// ===== Authenticated routes =====
		r.Group(func(r chi.Router) {
			r.Use(requireAuth)

			// Step-up auth — rate-limited to prevent brute-force re-auth
			if deps.RateLimiter != nil {
				r.With(deps.RateLimiter.PerIP).Post("/auth/step-up", deps.Auth.HandleStepUp)
			} else {
				r.Post("/auth/step-up", deps.Auth.HandleStepUp)
			}

			// TOTP 2FA management — rate-limited
			totpMw := []func(http.Handler) http.Handler{requireStepUp}
			if deps.RateLimiter != nil {
				totpMw = append(totpMw, deps.RateLimiter.PerIP)
			}
			r.With(totpMw...).Post("/auth/totp/setup", deps.Auth.HandleTOTPSetup)
			r.With(rateLimitOrNoop(deps.RateLimiter)...).Post("/auth/totp/enable", deps.Auth.HandleTOTPEnable)
			r.With(totpMw...).Post("/auth/totp/disable", deps.Auth.HandleTOTPDisable)
			r.With(rateLimitOrNoop(deps.RateLimiter)...).Post("/auth/totp/verify", deps.Auth.HandleTOTPVerify)

			// Password change (requires step-up + rate limit)
			r.With(requireStepUp).With(rateLimitOrNoop(deps.RateLimiter)...).Post("/auth/password/change", deps.Auth.HandlePasswordChange)

			// API keys (PRD §10.5)
			r.Post("/users/me/api-keys", deps.APIKey.HandleCreateAPIKey)
			r.Get("/users/me/api-keys", deps.APIKey.HandleListAPIKeys)
			r.Delete("/users/me/api-keys/{id}", deps.APIKey.HandleDeleteAPIKey)

			// User profile & sessions
			r.Get("/users/me", deps.User.HandleGetProfile)
			r.Put("/users/me", deps.User.HandleUpdateProfile)
			r.Get("/users/me/sessions", deps.User.HandleListSessions)
			r.Delete("/users/me/sessions/{id}", deps.User.HandleRevokeSession)

			// Organizations (admin only)
			r.With(requireAdmin).Post("/orgs", deps.Org.HandleCreateOrg)
			r.Route("/orgs/{id}", func(r chi.Router) {
				r.Get("/members", deps.Org.HandleListOrgMembers)
				r.With(requireAdmin).Put("/members/{userId}", deps.Org.HandleUpdateMemberRole)
				// C2 unconditional vault rekey trigger: cascades into every
				// shared vault the target user belonged to.
				r.With(requireAdmin).Delete("/members/{userId}", deps.Org.HandleRemoveOrgMember)
				// Organization member public key
				r.Get("/members/{userId}/pubkey", deps.User.HandleGetMemberPublicKey)

				// Invite management (admin only) — scoped to the org
				r.With(requireAdmin).Post("/invites", deps.Invite.HandleCreateInvite)
				r.With(requireAdmin).Get("/invites", deps.Invite.HandleListInvites)
				r.With(requireAdmin).Delete("/invites/{inviteId}", deps.Invite.HandleRevokeInvite)
			})

			// Admin
			r.With(requireAdmin).Post("/admin/backup", deps.Admin.HandleBackup)
			r.With(requireAdmin).Get("/admin/backups", deps.Admin.HandleListBackups)

			// Data export (step-up required — sensitive data)
			r.With(requireStepUp).Get("/export", deps.Export.HandleExport)

			// Data import
			r.Post("/import", deps.Import.HandleImport)

			// Vault management
			r.Get("/vaults", deps.Vault.HandleListVaults)
			r.Post("/vaults", deps.Vault.HandleCreateVault)

			// Vault items
			r.Route("/vaults/{vaultId}", func(r chi.Router) {
				r.Get("/items", deps.Vault.HandleListItems)
				r.Post("/items", deps.Vault.HandleCreateItem)
				r.Get("/items/{id}", deps.Vault.HandleGetItem)
				r.Put("/items/{id}", deps.Vault.HandleUpdateItem)
				r.Delete("/items/{id}", deps.Vault.HandleTrashItem)

				// Trash
				r.Get("/trash", deps.Vault.HandleListTrash)
				r.Post("/trash/{id}/restore", deps.Vault.HandleRestoreItem)
				// H10 step-up required for irreversible purge
				r.With(requireStepUp).Delete("/trash/{id}", deps.Vault.HandlePurgeItem)
				// Bulk purge all expired trash (H10 step-up required)
				r.With(requireStepUp).Delete("/trash", deps.Vault.HandlePurgeExpiredTrash)

				// Folders
				r.Get("/folders", deps.Vault.HandleListFolders)
				r.Post("/folders", deps.Vault.HandleCreateFolder)
				r.Put("/folders/{folderId}", deps.Vault.HandleRenameFolder)
				r.Delete("/folders/{folderId}", deps.Vault.HandleDeleteFolder)

				// Sharing
				r.Post("/members", deps.Vault.HandleShareVault)
				r.Delete("/members/{userId}", deps.Vault.HandleRemoveMember)
				r.Put("/rekey", deps.Vault.HandleRekeyVault)
			})
		})
	})

	return r
}

// healthHandler returns server health status.
// @Summary Health check
// @Description Returns server health status
// @Tags System
// @Produce json
// @Success 200 {object} map[string]string
// @Router /health [get]
func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// configHandler returns public server configuration.
// @Summary Server config
// @Description Returns public server configuration (no secrets)
// @Tags System
// @Produce json
// @Success 200 {object} map[string]any
// @Router /config [get]
func configHandler(registrationMode string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"version":          "v1",
			"registrationMode": registrationMode,
		})
	}
}

// rateLimitOrNoop returns the PerIP middleware as a slice suitable for
// chi's With(), or an empty slice when no limiter is configured.
func rateLimitOrNoop(rl *middleware.RateLimiter) []func(http.Handler) http.Handler {
	if rl == nil {
		return nil
	}
	return []func(http.Handler) http.Handler{rl.PerIP}
}
