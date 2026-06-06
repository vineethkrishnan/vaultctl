// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"io/fs"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	httpSwagger "github.com/swaggo/http-swagger/v2"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
	webembed "github.com/vineethkrishnan/vaultctl/web"

	_ "github.com/vineethkrishnan/vaultctl/docs" // swagger generated docs
)

// Dependencies bundles the wired services the router needs.
type Dependencies struct {
	Tokens             ports.TokenIssuer
	Clock              ports.Clock
	Auth               *AuthHandlers
	User               *UserHandlers
	Vault              *VaultHandlers
	Attachment         *AttachmentHandlers
	APIKey             *APIKeyHandlers
	Invite             *InviteHandlers
	Org                *OrgHandlers
	Admin              *AdminHandlers
	Export             *ExportHandlers
	Import             *ImportHandlers
	Backup             *BackupHandlers
	BackupOAuth        *BackupOAuthHandlers
	Update             *UpdateHandlers
	Notification       *NotificationHandlers
	Audit              *AuditHandlers
	APIKeyValidator    middleware.APIKeyValidator
	RateLimiter        *middleware.RateLimiter
	TrustedProxies     []*net.IPNet
	CORSAllowedOrigins []string
	RegistrationMode   string
	Env                string
	Version            string
	Commit             string
	GoVersion          string
	DB                 Pinger
	// EmailVerifyGate gates vault mutations for accounts unverified past the
	// grace window. Nil when email verification is not enforced (no mailer).
	EmailVerifyGate func(http.Handler) http.Handler
	// MailerEnabled reports whether an SMTP mailer is configured. Email
	// verification and digests are only mounted when this is true.
	MailerEnabled bool
	// Require2FA mirrors cfg.Require2FA so the client can surface the policy.
	Require2FA bool
}

// ConfigFeatures advertises which optional feature sets this deployment has
// wired, so the client can hide UI that would otherwise hit unmounted routes.
type ConfigFeatures struct {
	BackupSync        bool `json:"backupSync"`
	Attachments       bool `json:"attachments"`
	Mailer            bool `json:"mailer"`
	EmailVerification bool `json:"emailVerification"`
	Updates           bool `json:"updates"`
	Notifications     bool `json:"notifications"`
	Require2FA        bool `json:"require2fa"`
}

func (deps Dependencies) features() ConfigFeatures {
	return ConfigFeatures{
		BackupSync:        deps.Backup != nil,
		Attachments:       deps.Attachment != nil,
		Mailer:            deps.MailerEnabled,
		EmailVerification: deps.Auth != nil && deps.Auth.VerifyEmail != nil,
		Updates:           deps.Update != nil && deps.Update.Enabled,
		Notifications:     deps.Notification != nil,
		Require2FA:        deps.Require2FA,
	}
}

// Pinger is the readiness probe the health endpoint uses to confirm the vault's
// backing store is reachable. *pgxpool.Pool satisfies it; the composition root
// (wire.go) binds the concrete pool so this package stays free of infra imports.
type Pinger interface {
	Ping(ctx context.Context) error
}

// NewRouter assembles the chi router with the full middleware stack and
// every endpoint from PRD §10.
func NewRouter(deps Dependencies) http.Handler {
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(middleware.RealIP(deps.TrustedProxies))
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
		r.Get("/health", healthHandler(deps.DB))
		r.Get("/config", configHandler(deps))

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

			// Invite redemption is public - new users redeem before registering
			r.Post("/auth/invites/redeem", deps.Invite.HandleRedeemInvite)
		})

		// Cloud-backup OAuth callback is a top-level provider redirect with no
		// Authorization header; the signed state attributes it to a user.
		if deps.BackupOAuth != nil {
			r.Get("/backup/oauth/{provider}/callback", deps.BackupOAuth.HandleCallback)
		}

		// ===== Authenticated routes =====
		r.Group(func(r chi.Router) {
			r.Use(requireAuth)

			// Step-up auth - rate-limited to prevent brute-force re-auth
			if deps.RateLimiter != nil {
				r.With(deps.RateLimiter.PerIP).Post("/auth/step-up", deps.Auth.HandleStepUp)
			} else {
				r.Post("/auth/step-up", deps.Auth.HandleStepUp)
			}

			// TOTP 2FA management - rate-limited
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

			// Recovery-kit (re)generation (requires step-up + rate limit)
			r.With(requireStepUp).With(rateLimitOrNoop(deps.RateLimiter)...).Post("/auth/recovery/rotate", deps.Auth.HandleRotateRecoveryKey)

			// Email verification (mounted only when a mailer is wired).
			// Rate-limited per-IP like the TOTP routes: the code is short, so
			// verify must not be brute-forceable and resend must not mail-bomb.
			if deps.Auth.VerifyEmail != nil {
				r.With(rateLimitOrNoop(deps.RateLimiter)...).Post("/auth/email/verify", deps.Auth.HandleVerifyEmail)
				r.With(rateLimitOrNoop(deps.RateLimiter)...).Post("/auth/email/resend", deps.Auth.HandleResendVerification)
			}

			// Update check + in-app notification feed
			if deps.Update != nil {
				r.Get("/updates", deps.Update.HandleGetUpdates)
			}
			if deps.Notification != nil {
				r.Get("/notifications", deps.Notification.HandleList)
				r.Post("/notifications/read", deps.Notification.HandleMarkRead)
				r.Post("/notifications/clear", deps.Notification.HandleClear)
			}

			// API keys (PRD §10.5)
			r.Post("/users/me/api-keys", deps.APIKey.HandleCreateAPIKey)
			r.Get("/users/me/api-keys", deps.APIKey.HandleListAPIKeys)
			r.Delete("/users/me/api-keys/{id}", deps.APIKey.HandleDeleteAPIKey)

			// User profile & sessions
			r.Get("/users/me", deps.User.HandleGetProfile)
			r.Put("/users/me", deps.User.HandleUpdateProfile)
			r.Get("/users/me/sessions", deps.User.HandleListSessions)
			r.Delete("/users/me/sessions/{id}", deps.User.HandleRevokeSession)

			// Self-audit activity trail (FEAT-2)
			if deps.Audit != nil {
				r.Get("/users/me/audit", deps.Audit.HandleListOwnAudit)
			}

			// Email-digest preferences (only when a mailer is wired)
			if deps.User.Digest != nil {
				r.Get("/users/me/email-preferences", deps.User.HandleGetEmailPreferences)
				r.Put("/users/me/email-preferences", deps.User.HandleUpdateEmailPreferences)
			}

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

				// Invite management (admin only) - scoped to the org
				r.With(requireAdmin).Post("/invites", deps.Invite.HandleCreateInvite)
				r.With(requireAdmin).Get("/invites", deps.Invite.HandleListInvites)
				r.With(requireAdmin).Delete("/invites/{inviteId}", deps.Invite.HandleRevokeInvite)
			})

			// Admin
			r.With(requireAdmin).Post("/admin/backup", deps.Admin.HandleBackup)
			r.With(requireAdmin).Get("/admin/backups", deps.Admin.HandleListBackups)

			// Data export (step-up required - sensitive data)
			r.With(requireStepUp).Get("/export", deps.Export.HandleExport)

			// Data import
			r.Post("/import", deps.Import.HandleImport)

			// Per-user backup destinations (sync). Only wired when sealing is
			// available (server data key set) and the feature is enabled.
			if deps.BackupOAuth != nil {
				r.Post("/backup/oauth/{provider}/start", deps.BackupOAuth.HandleStart)
			}
			if deps.Backup != nil {
				r.Get("/backup/providers", deps.Backup.HandleProviders)
				r.Route("/backup/destinations", func(r chi.Router) {
					r.Get("/", deps.Backup.HandleList)
					r.Post("/", deps.Backup.HandleConfigure)
					r.Route("/{id}", func(r chi.Router) {
						r.Put("/", deps.Backup.HandleConfigure)
						r.Delete("/", deps.Backup.HandleDelete)
						r.Post("/run", deps.Backup.HandleRunNow)
						r.Get("/runs", deps.Backup.HandleListRuns)
						r.Get("/artifacts", deps.Backup.HandleListArtifacts)
						// Restore returns the (client-encrypted) export payload -
						// sensitive, so step-up is required as with /export.
						r.With(requireStepUp).Get("/restore", deps.Backup.HandleRestore)
					})
				})
			}

			// Vault data routes. When email verification is enforced, the gate
			// blocks mutating requests from accounts unverified past the grace
			// window (read-only) while still allowing reads.
			r.Group(func(r chi.Router) {
				if deps.EmailVerifyGate != nil {
					r.Use(deps.EmailVerifyGate)
				}

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

					// Encrypted attachments (only when the blob store is available)
					if deps.Attachment != nil {
						r.Get("/items/{id}/attachments", deps.Attachment.HandleList)
						r.Post("/items/{id}/attachments", deps.Attachment.HandleCreate)
						r.Get("/items/{id}/attachments/{attachmentId}", deps.Attachment.HandleDownload)
						r.Delete("/items/{id}/attachments/{attachmentId}", deps.Attachment.HandleDelete)
					}

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
	})

	mountSPA(r)

	return r
}

// mountSPA serves the embedded web/dist bundle. Hashed assets get long-lived
// caching; every other path falls back to index.html so the React Router
// owns client-side routing. /api/v1 and /swagger are reserved by chi above.
func mountSPA(r chi.Router) {
	dist, err := webembed.DistFS()
	if err != nil {
		return
	}

	indexBytes, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		return
	}

	fileServer := http.FileServer(http.FS(dist))

	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/")

		// Don't blanket-serve the SPA shell on reserved server-side prefixes.
		// Chi already handled the real /api/v1 routes above; anything left
		// under these prefixes is a real 404, not a deep link.
		if strings.HasPrefix(path, "api/") || strings.HasPrefix(path, "swagger/") {
			http.NotFound(w, req)
			return
		}

		if path == "" {
			serveIndex(w, indexBytes)
			return
		}

		f, err := dist.Open(path)
		if err != nil {
			serveIndex(w, indexBytes)
			return
		}
		defer func() { _ = f.Close() }()

		stat, err := f.Stat()
		if err != nil || stat.IsDir() {
			serveIndex(w, indexBytes)
			return
		}

		if strings.HasPrefix(path, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fileServer.ServeHTTP(w, req)
	})
}

func serveIndex(w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// healthHandler returns server and vault (database) health.
// @Summary Health check
// @Description Reports liveness and pings the database. Returns 503 when the database is unreachable.
// @Tags System
// @Produce json
// @Success 200 {object} map[string]any
// @Failure 503 {object} map[string]any
// @Router /health [get]
func healthHandler(db Pinger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		databaseStatus := "ok"
		if db != nil {
			if err := db.Ping(ctx); err != nil {
				databaseStatus = "down"
			}
		}

		if databaseStatus != "ok" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{
				"status": "degraded",
				"checks": map[string]string{"database": databaseStatus},
				"error": map[string]string{
					"code":    "DB_UNAVAILABLE",
					"message": "The server is running but its database is unavailable.",
				},
			})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"checks": map[string]string{"database": databaseStatus},
		})
	}
}

// configHandler returns public server configuration.
// @Summary Server config
// @Description Returns public server configuration (no secrets)
// @Tags System
// @Produce json
// @Success 200 {object} map[string]any
// @Router /config [get]
func configHandler(deps Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"version":          "v1",
			"registrationMode": deps.RegistrationMode,
			"appVersion":       deps.Version,
			"commit":           deps.Commit,
			"goVersion":        deps.GoVersion,
			"features":         deps.features(),
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
