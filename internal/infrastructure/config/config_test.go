// SPDX-License-Identifier: AGPL-3.0-or-later

package config

import (
	"errors"
	"strings"
	"testing"
)

const sslModeDisable = "disable"

// setEnv sets a batch of env vars for the duration of a test.
func setEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

// productionMinimum is the smallest viable env for production startup.
func productionMinimum() map[string]string {
	return map[string]string{
		"VAULTCTL_ENV":                 "production",
		"VAULTCTL_DB_PASSWORD":         "db-password",
		"VAULTCTL_JWT_SECRET_CURRENT":  "jwt-secret-long-enough-to-matter-xxxxxxxxxxxxxxxxx",
		"VAULTCTL_DATA_ENCRYPTION_KEY": "data-key-base64",
		"VAULTCTL_SERVER_PEPPER":       "server-pepper-at-least-sixteen-chars",
		"VAULTCTL_ENUMERATION_PEPPER":  "enumeration-pepper-at-least-sixteen-chars",
		"VAULTCTL_BASE_URL":            "https://vault.example.com",
	}
}

func TestLoad_Development_Lenient(t *testing.T) {
	setEnv(t, map[string]string{"VAULTCTL_ENV": "development"})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("dev load: %v", err)
	}
	if cfg.Env != EnvDevelopment {
		t.Fatalf("env wrong: %v", cfg.Env)
	}
	if cfg.Port != 8080 {
		t.Fatalf("default port not applied: %d", cfg.Port)
	}
}

func TestLoad_Production_ConfirmsAllSecrets(t *testing.T) {
	setEnv(t, productionMinimum())
	cfg, err := Load()
	if err != nil {
		t.Fatalf("prod load: %v", err)
	}
	if cfg.DBSSLMode != "require" {
		t.Fatalf("default SSL mode wrong: %q", cfg.DBSSLMode)
	}
}

func TestLoad_Production_RejectsMissingSecret(t *testing.T) {
	for _, missing := range []string{
		"VAULTCTL_DB_PASSWORD",
		"VAULTCTL_JWT_SECRET_CURRENT",
		"VAULTCTL_DATA_ENCRYPTION_KEY",
		"VAULTCTL_SERVER_PEPPER",
		"VAULTCTL_ENUMERATION_PEPPER",
		"VAULTCTL_BASE_URL",
	} {
		t.Run(missing, func(t *testing.T) {
			env := productionMinimum()
			delete(env, missing)
			setEnv(t, env)
			_, err := Load()
			if !errors.Is(err, ErrMissingProdSecrets) {
				t.Fatalf("expected ErrMissingProdSecrets, got %v", err)
			}
			if !strings.Contains(err.Error(), strings.TrimPrefix(missing, "VAULTCTL_")) && !strings.Contains(err.Error(), missing) {
				t.Fatalf("error should name %q: %v", missing, err)
			}
		})
	}
}

func TestLoad_Production_RejectsShortSecret(t *testing.T) {
	cases := map[string]string{
		"VAULTCTL_JWT_SECRET_CURRENT": "too-short",
		"VAULTCTL_JWT_SECRET_NEXT":    "too-short",
		"VAULTCTL_SERVER_PEPPER":      "short",
		"VAULTCTL_ENUMERATION_PEPPER": "short",
	}
	for name, weak := range cases {
		t.Run(name, func(t *testing.T) {
			env := productionMinimum()
			env[name] = weak
			setEnv(t, env)
			_, err := Load()
			if !errors.Is(err, ErrWeakProdSecrets) {
				t.Fatalf("expected ErrWeakProdSecrets for short %s, got %v", name, err)
			}
			if !strings.Contains(err.Error(), name) {
				t.Fatalf("error should name %q: %v", name, err)
			}
		})
	}
}

func TestLoad_Production_AllowsEmptyJWTNext(t *testing.T) {
	// JWT_SECRET_NEXT is optional; an empty value must not trip the length floor.
	env := productionMinimum()
	env["VAULTCTL_JWT_SECRET_NEXT"] = ""
	setEnv(t, env)
	if _, err := Load(); err != nil {
		t.Fatalf("empty optional JWT_SECRET_NEXT should be allowed, got %v", err)
	}
}

func TestLoad_Production_RejectsSSLDisable_H12(t *testing.T) {
	env := productionMinimum()
	env["VAULTCTL_DB_SSL_MODE"] = sslModeDisable
	setEnv(t, env)
	_, err := Load()
	if !errors.Is(err, ErrMissingProdSecrets) {
		t.Fatalf("H12 production SSL disable should fail, got %v", err)
	}
	if !strings.Contains(err.Error(), "H12") {
		t.Fatalf("error should cite H12, got: %v", err)
	}
}

func TestLoad_Production_AllowsSSLDisable_WithExplicitInsecureOK_H12(t *testing.T) {
	env := productionMinimum()
	env["VAULTCTL_DB_SSL_MODE"] = sslModeDisable
	env["VAULTCTL_DB_SSL_INSECURE_OK"] = "true"
	setEnv(t, env)
	if _, err := Load(); err != nil {
		t.Fatalf("explicit insecure-ok opt-in should permit ssl_mode=disable, got %v", err)
	}
}

func TestLoad_RedactFields_ParsedAsSlice(t *testing.T) {
	setEnv(t, map[string]string{"VAULTCTL_ENV": "development"})
	cfg, _ := Load()
	if len(cfg.LogRedactFields) < 5 {
		t.Fatalf("redact fields not split: %v", cfg.LogRedactFields)
	}
	want := []string{"authHash", "password", "refresh_token", "api_key"}
	seen := make(map[string]struct{}, len(cfg.LogRedactFields))
	for _, f := range cfg.LogRedactFields {
		seen[f] = struct{}{}
	}
	for _, f := range want {
		if _, ok := seen[f]; !ok {
			t.Fatalf("default redact set missing %q", f)
		}
	}
}

func TestLoad_RejectsNonHTTPBaseURL(t *testing.T) {
	for _, bad := range []string{
		"javascript:alert(1)",
		"ftp://example.com",
		"://no-scheme",
		"https://", // missing host
	} {
		t.Run(bad, func(t *testing.T) {
			setEnv(t, map[string]string{
				"VAULTCTL_ENV":      "development",
				"VAULTCTL_BASE_URL": bad,
			})
			if _, err := Load(); !errors.Is(err, ErrInvalidConfig) {
				t.Fatalf("expected ErrInvalidConfig for %q, got %v", bad, err)
			}
		})
	}
}

func TestLoad_AcceptsHTTPBaseURL(t *testing.T) {
	for _, ok := range []string{"http://localhost:8080", "https://vault.example.com"} {
		t.Run(ok, func(t *testing.T) {
			setEnv(t, map[string]string{
				"VAULTCTL_ENV":      "development",
				"VAULTCTL_BASE_URL": ok,
			})
			if _, err := Load(); err != nil {
				t.Fatalf("expected %q to load, got %v", ok, err)
			}
		})
	}
}

func TestLoad_TrustedProxies_ParsedAsSlice(t *testing.T) {
	setEnv(t, map[string]string{
		"VAULTCTL_ENV":             "development",
		"VAULTCTL_TRUSTED_PROXIES": "10.0.0.0/8,192.168.0.0/16",
	})
	cfg, _ := Load()
	if len(cfg.TrustedProxies) != 2 {
		t.Fatalf("expected 2 CIDRs, got %v", cfg.TrustedProxies)
	}
}
