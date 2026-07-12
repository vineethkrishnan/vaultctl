// SPDX-License-Identifier: AGPL-3.0-or-later

// Package config loads vaultctl server configuration from environment variables.
//
// Every key here mirrors the VAULTCTL_ prefix enumerated in prd.md §11.1.
// Values that are load-bearing for security (data-encryption key, server peppers,
// JWT secrets, SSL mode) have NO defaults and MUST be supplied explicitly in
// production (VAULTCTL_ENV=production) - fail-closed by construction.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/caarlos0/env/v10"
)

type Env string

const (
	EnvProduction  Env = "production"
	EnvDevelopment Env = "development"
)

// Config is the fully-parsed server configuration.
type Config struct {
	// ===========================================================================
	// Server
	// ===========================================================================
	Port    int    `env:"VAULTCTL_PORT" envDefault:"8080"`
	Host    string `env:"VAULTCTL_HOST" envDefault:"0.0.0.0"`
	BaseURL string `env:"VAULTCTL_BASE_URL"`
	Env     Env    `env:"VAULTCTL_ENV" envDefault:"development"`

	// ===========================================================================
	// Database
	// ===========================================================================
	DBHost     string `env:"VAULTCTL_DB_HOST" envDefault:"localhost"`
	DBPort     int    `env:"VAULTCTL_DB_PORT" envDefault:"5432"`
	DBName     string `env:"VAULTCTL_DB_NAME" envDefault:"vaultctl"`
	DBUser     string `env:"VAULTCTL_DB_USER" envDefault:"vaultctl"`
	DBPassword string `env:"VAULTCTL_DB_PASSWORD"`
	DBSSLMode  string `env:"VAULTCTL_DB_SSL_MODE" envDefault:"require"` // [H12] default: require
	// [H12] explicit opt-out for the bundled docker-compose where vaultctl
	// reaches Postgres over a private bridge network and cannot negotiate TLS.
	// Operators must set this in addition to VAULTCTL_DB_SSL_MODE=disable.
	DBSSLInsecureOK bool `env:"VAULTCTL_DB_SSL_INSECURE_OK" envDefault:"false"`

	// ===========================================================================
	// JWT signing keys - dual-key rotation (H8)
	// ===========================================================================
	JWTSecretCurrent string        `env:"VAULTCTL_JWT_SECRET_CURRENT"`
	JWTSecretNext    string        `env:"VAULTCTL_JWT_SECRET_NEXT"`
	JWTKidCurrent    string        `env:"VAULTCTL_JWT_KID_CURRENT" envDefault:"k1"`
	JWTAccessTTL     time.Duration `env:"VAULTCTL_JWT_ACCESS_TTL" envDefault:"15m"`
	JWTRefreshTTL    time.Duration `env:"VAULTCTL_JWT_REFRESH_TTL" envDefault:"168h"`

	// ===========================================================================
	// Server-side data encryption key (H5) + rotation
	// ===========================================================================
	DataEncryptionKey     string `env:"VAULTCTL_DATA_ENCRYPTION_KEY"`
	DataEncryptionKeyNext string `env:"VAULTCTL_DATA_ENCRYPTION_KEY_NEXT"`

	// ===========================================================================
	// Server peppers (C3, H7, H2)
	// ===========================================================================
	ServerPepper      string `env:"VAULTCTL_SERVER_PEPPER"`
	EnumerationPepper string `env:"VAULTCTL_ENUMERATION_PEPPER"`

	// ===========================================================================
	// Security
	// ===========================================================================
	RegistrationMode string `env:"VAULTCTL_REGISTRATION_MODE" envDefault:"invite"`
	Require2FA       bool   `env:"VAULTCTL_REQUIRE_2FA" envDefault:"false"`
	// HIBPEnabled lets the client offer an opt-in Have I Been Pwned breach
	// check (k-anonymity range API, client-side - the server makes no HIBP
	// calls). Off by default so air-gapped self-hosters never phone home.
	HIBPEnabled              bool          `env:"VAULTCTL_HIBP_ENABLED" envDefault:"false"`
	MaxLoginAttempts         int           `env:"VAULTCTL_MAX_LOGIN_ATTEMPTS" envDefault:"5"`
	LockoutDuration          time.Duration `env:"VAULTCTL_LOCKOUT_DURATION" envDefault:"15m"`
	RateLimitRPM             int           `env:"VAULTCTL_RATE_LIMIT_RPM" envDefault:"60"`
	AuthRateLimitPerEmail    int           `env:"VAULTCTL_AUTH_RATE_LIMIT_PER_EMAIL" envDefault:"5"`
	AuthRateLimitWindow      time.Duration `env:"VAULTCTL_AUTH_RATE_LIMIT_WINDOW" envDefault:"15m"`
	AuthGlobalAlertThreshold int           `env:"VAULTCTL_AUTH_GLOBAL_ALERT_THRESHOLD" envDefault:"1000"`
	// CIDRs trusted to set X-Forwarded-For. Defaults to loopback + RFC1918
	// because both shipped compose stacks (Caddy + simple) put the proxy on
	// a private network. Override to a stricter list when running with a
	// public-IP proxy. An empty list disables XFF entirely.
	TrustedProxies     []string      `env:"VAULTCTL_TRUSTED_PROXIES" envDefault:"127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128,fc00::/7" envSeparator:","`
	StepUpMaxAge       time.Duration `env:"VAULTCTL_STEP_UP_MAX_AGE" envDefault:"5m"`
	CORSAllowedOrigins []string      `env:"VAULTCTL_CORS_ALLOWED_ORIGINS" envSeparator:","`

	// ===========================================================================
	// Update check
	// ===========================================================================
	// When enabled, the server periodically queries the GitHub Releases API of
	// UpdateRepo (one outbound call per cache window, server-side only - clients
	// never phone home) and exposes the result via GET /api/v1/updates. The
	// scheduler also refreshes this cache on the same interval so a new release
	// is detected within one window even without client traffic.
	UpdateCheckEnabled  bool          `env:"VAULTCTL_UPDATE_CHECK_ENABLED" envDefault:"true"`
	UpdateRepo          string        `env:"VAULTCTL_UPDATE_REPO" envDefault:"vineethkrishnan/vaultctl"`
	UpdateCheckInterval time.Duration `env:"VAULTCTL_UPDATE_CHECK_INTERVAL" envDefault:"15m"`
	// UpdateRolloutDelay withholds the update alert from clients until this long
	// after a release's publish time (staged rollout). 0 reveals immediately
	// once detected; e.g. 48h gives a buffer to pull or patch a bad release
	// before customers are prompted.
	UpdateRolloutDelay time.Duration `env:"VAULTCTL_UPDATE_ROLLOUT_DELAY" envDefault:"0"`

	// In-app upgrade (one-click update for self-hosted deployments).
	// UpgradeEnabled gates the POST /updates/apply endpoint. Set to true
	// alongside exactly one of UpgradeHookURL or UpgradeHookScript.
	//
	// UpgradeHookURL: full URL of an HTTP endpoint to POST to when the
	// user clicks "Update Now". Use this for Watchtower's HTTP API or a
	// custom webhook on the host. UpgradeHookToken is sent as a Bearer token.
	//
	// UpgradeHookScript: absolute path to a shell script the server will exec.
	// The script receives no arguments; its stdout/stderr are streamed to the
	// client. It should pull the new image, run migrations, and restart the
	// service. UpgradeHookURL takes precedence if both are set.
	UpgradeEnabled    bool   `env:"VAULTCTL_UPGRADE_ENABLED" envDefault:"false"`
	UpgradeHookURL    string `env:"VAULTCTL_UPGRADE_HOOK_URL"`
	UpgradeHookToken  string `env:"VAULTCTL_UPGRADE_HOOK_TOKEN"`
	UpgradeHookScript string `env:"VAULTCTL_UPGRADE_HOOK_SCRIPT"`

	// ===========================================================================
	// Email (SMTP). Transactional mail for signup verification, security
	// alerts, and digests. Mail is disabled (logged, not sent) until SMTPHost
	// is set, so a deployment without SMTP stays usable - email-gated features
	// then skip their gate. SMTPTLS is one of: starttls (587), tls (465), none.
	// ===========================================================================
	SMTPHost     string        `env:"VAULTCTL_SMTP_HOST"`
	SMTPPort     int           `env:"VAULTCTL_SMTP_PORT" envDefault:"587"`
	SMTPUsername string        `env:"VAULTCTL_SMTP_USERNAME"`
	SMTPPassword string        `env:"VAULTCTL_SMTP_PASSWORD"`
	SMTPFrom     string        `env:"VAULTCTL_SMTP_FROM" envDefault:"vaultctl <no-reply@localhost>"`
	SMTPTLS      string        `env:"VAULTCTL_SMTP_TLS" envDefault:"starttls"`
	SMTPTimeout  time.Duration `env:"VAULTCTL_SMTP_TIMEOUT" envDefault:"15s"`
	// EmailOTPTTL is how long a signup verification code stays valid.
	EmailOTPTTL time.Duration `env:"VAULTCTL_EMAIL_OTP_TTL" envDefault:"15m"`
	// EmailResendCooldown is the minimum gap between verification-code sends for
	// one user. A resend inside this window reuses the live code (no reset of the
	// attempt counter), so resend cannot be used to refresh the guess budget or
	// mail-bomb the inbox.
	EmailResendCooldown time.Duration `env:"VAULTCTL_EMAIL_RESEND_COOLDOWN" envDefault:"60s"`
	// EmailVerifyGrace is how long an unverified account keeps full access
	// before its vault becomes read-only (creates/edits/shares blocked) until
	// the email is confirmed. Only enforced when a mailer is configured.
	EmailVerifyGrace time.Duration `env:"VAULTCTL_EMAIL_VERIFY_GRACE" envDefault:"168h"`
	// LoginAlertsEnabled emails the user when a sign-in comes from a new device
	// or network. Only active when a mailer is configured.
	LoginAlertsEnabled bool `env:"VAULTCTL_LOGIN_ALERTS_ENABLED" envDefault:"true"`
	// LoginAlertNewNetworkEnabled controls the new-network alert specifically.
	// Off by default: the network is a /24-anonymised IP, so roaming mobile
	// users would otherwise get an alert on nearly every login. The new-device
	// alert stays on regardless.
	LoginAlertNewNetworkEnabled bool `env:"VAULTCTL_LOGIN_ALERT_NEW_NETWORK_ENABLED" envDefault:"false"`
	// KnownLoginRetention is how long a known-login row is kept before the purge
	// job deletes it. Bounds the unbounded growth of one row per distinct device
	// or network.
	KnownLoginRetention time.Duration `env:"VAULTCTL_KNOWN_LOGIN_RETENTION" envDefault:"8760h"`

	// ===========================================================================
	// Retention
	// ===========================================================================
	TrashRetentionDays  int `env:"VAULTCTL_TRASH_RETENTION_DAYS" envDefault:"30"`
	BackupRetentionDays int `env:"VAULTCTL_BACKUP_RETENTION_DAYS" envDefault:"90"`

	// ===========================================================================
	// Scheduled per-user backup destinations (sync). The artifact is the user's
	// client-encrypted export, sealed again with the server data key before it
	// leaves the box. Cloud providers activate only when their OAuth client
	// credentials are configured; the local destination is always available.
	// ===========================================================================
	BackupSyncEnabled bool   `env:"VAULTCTL_BACKUP_SYNC_ENABLED" envDefault:"true"`
	BackupLocalDir    string `env:"VAULTCTL_BACKUP_LOCAL_DIR" envDefault:"/data/backups"`
	// BackupAllowPrivate permits WebDAV/S3 backup destinations on RFC1918 / ULA
	// private ranges. Default true for the common single-owner self-host (a LAN
	// Nextcloud/MinIO is a first-class target). Set false on multi-user instances
	// so a member can't aim a destination at internal LAN services and use dial
	// timing/errors as a port scanner (loopback/link-local/metadata are always
	// blocked regardless).
	BackupAllowPrivate     bool   `env:"VAULTCTL_BACKUP_ALLOW_PRIVATE" envDefault:"true"`
	BackupGoogleClientID   string `env:"VAULTCTL_BACKUP_GOOGLE_CLIENT_ID"`
	BackupGoogleSecret     string `env:"VAULTCTL_BACKUP_GOOGLE_CLIENT_SECRET"`
	BackupDropboxClientID  string `env:"VAULTCTL_BACKUP_DROPBOX_CLIENT_ID"`
	BackupDropboxSecret    string `env:"VAULTCTL_BACKUP_DROPBOX_CLIENT_SECRET"`
	BackupOneDriveClientID string `env:"VAULTCTL_BACKUP_ONEDRIVE_CLIENT_ID"`
	BackupOneDriveSecret   string `env:"VAULTCTL_BACKUP_ONEDRIVE_CLIENT_SECRET"`

	// ===========================================================================
	// Attachments (encrypted file storage on the filesystem blob store)
	// ===========================================================================
	AttachmentsDir       string `env:"VAULTCTL_ATTACHMENTS_DIR" envDefault:"/data/attachments"`
	AttachmentMaxBytes   int64  `env:"VAULTCTL_ATTACHMENT_MAX_BYTES" envDefault:"26214400"`          // 25 MiB per file
	AttachmentVaultQuota int64  `env:"VAULTCTL_ATTACHMENT_VAULT_QUOTA_BYTES" envDefault:"524288000"` // 500 MiB per vault

	// ===========================================================================
	// Logging (C4, M1)
	// ===========================================================================
	LogLevel        string   `env:"VAULTCTL_LOG_LEVEL" envDefault:"info"`
	LogFormat       string   `env:"VAULTCTL_LOG_FORMAT" envDefault:"json"`
	LogIPPrecision  string   `env:"VAULTCTL_LOG_IP_PRECISION" envDefault:"coarse"`
	LogRedactFields []string `env:"VAULTCTL_LOG_REDACT_FIELDS" envDefault:"authHash,password,refresh_token,api_key,totp,masterKey,stretchedKey" envSeparator:","`
}

// Load parses the config from the process environment.
// Returns ErrMissingProdSecrets if required secrets are unset in production.
func Load() (*Config, error) {
	cfg := &Config{}
	if err := env.Parse(cfg); err != nil {
		return nil, fmt.Errorf("parse env: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

var ErrMissingProdSecrets = errors.New("missing required production secrets")

var ErrInvalidConfig = errors.New("invalid configuration")

func (c *Config) validate() error {
	// BaseURL is escaped into email CTA hrefs, so a non-http(s) scheme would
	// render a clickable javascript:/data: link. Reject it in every env.
	if err := validateBaseURL(c.BaseURL); err != nil {
		return err
	}

	if c.Env != EnvProduction {
		return nil
	}

	// Fail-closed in production: every load-bearing secret must be present.
	var missing []string
	check := func(name, value string) {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, name)
		}
	}
	check("VAULTCTL_DB_PASSWORD", c.DBPassword)
	check("VAULTCTL_JWT_SECRET_CURRENT", c.JWTSecretCurrent)
	check("VAULTCTL_DATA_ENCRYPTION_KEY", c.DataEncryptionKey)
	check("VAULTCTL_SERVER_PEPPER", c.ServerPepper)
	check("VAULTCTL_ENUMERATION_PEPPER", c.EnumerationPepper)
	check("VAULTCTL_BASE_URL", c.BaseURL)

	if c.DBSSLMode == "disable" && !c.DBSSLInsecureOK {
		return fmt.Errorf("%w: VAULTCTL_DB_SSL_MODE=disable requires VAULTCTL_DB_SSL_INSECURE_OK=true in production (H12)", ErrMissingProdSecrets)
	}
	if len(missing) > 0 {
		return fmt.Errorf("%w: %s", ErrMissingProdSecrets, strings.Join(missing, ", "))
	}
	return nil
}

// validateBaseURL accepts an empty value (the gate/email features tolerate it)
// but rejects any non-http(s) or malformed URL.
func validateBaseURL(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%w: VAULTCTL_BASE_URL is not a valid URL: %w", ErrInvalidConfig, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%w: VAULTCTL_BASE_URL must use http or https, got %q", ErrInvalidConfig, parsed.Scheme)
	}
	if parsed.Host == "" {
		return fmt.Errorf("%w: VAULTCTL_BASE_URL must include a host", ErrInvalidConfig)
	}
	return nil
}
