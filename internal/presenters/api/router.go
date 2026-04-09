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
	Vault              *VaultHandlers
	APIKey             *APIKeyHandlers
	Invite             *InviteHandlers
	APIKeyValidator    middleware.APIKeyValidator
	RateLimiter        *middleware.RateLimiter
	CORSAllowedOrigins []string
	RegistrationMode   string
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

	r.Get("/swagger/*", httpSwagger.Handler(
		httpSwagger.URL("/swagger/doc.json"),
	))

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
			r.Post("/auth/login", deps.Auth.HandleLogin)
			r.Post("/auth/refresh", deps.Auth.HandleRefresh)
			r.Post("/auth/logout", deps.Auth.HandleLogout)

			// Invite redemption is public — new users redeem before registering
			r.Post("/invites/redeem", deps.Invite.HandleRedeemInvite)
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

			// Invite management (admin only)
			r.With(requireAdmin).Post("/invites", deps.Invite.HandleCreateInvite)
			r.With(requireAdmin).Get("/invites", deps.Invite.HandleListInvites)
			r.With(requireAdmin).Delete("/invites/{id}", deps.Invite.HandleRevokeInvite)

			// API keys
			r.Post("/api-keys", deps.APIKey.HandleCreateAPIKey)
			r.Get("/api-keys", deps.APIKey.HandleListAPIKeys)
			r.Delete("/api-keys/{id}", deps.APIKey.HandleDeleteAPIKey)

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

				// Folders
				r.Get("/folders", deps.Vault.HandleListFolders)
				r.Post("/folders", deps.Vault.HandleCreateFolder)
				r.Put("/folders/{folderId}", deps.Vault.HandleRenameFolder)
				r.Delete("/folders/{folderId}", deps.Vault.HandleDeleteFolder)

				// Sharing
				r.Post("/members", deps.Vault.HandleShareVault)
				r.Delete("/members/{userId}", deps.Vault.HandleRemoveMember)
				r.Post("/rekey", deps.Vault.HandleRekeyVault)
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
