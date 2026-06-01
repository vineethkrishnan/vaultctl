// SPDX-License-Identifier: AGPL-3.0-or-later

// Package config loads vaultctl server configuration from environment variables.
//
// Every key here mirrors the VAULTCTL_ prefix enumerated in prd.md §11.1.
// Values that are load-bearing for security (data-encryption key, server peppers,
// JWT secrets, SSL mode) have NO defaults and MUST be supplied explicitly in
// production (VAULTCTL_ENV=production) — fail-closed by construction.
package config

import (
	"errors"
	"fmt"
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
	// JWT signing keys — dual-key rotation (H8)
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
	RegistrationMode         string        `env:"VAULTCTL_REGISTRATION_MODE" envDefault:"invite"`
	Require2FA               bool          `env:"VAULTCTL_REQUIRE_2FA" envDefault:"false"`
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
	BackupSyncEnabled      bool   `env:"VAULTCTL_BACKUP_SYNC_ENABLED" envDefault:"true"`
	BackupLocalDir         string `env:"VAULTCTL_BACKUP_LOCAL_DIR" envDefault:"/data/backups"`
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

func (c *Config) validate() error {
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
