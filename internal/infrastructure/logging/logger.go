// SPDX-License-Identifier: AGPL-3.0-or-later

// Package logging wires slog with the redaction layer mandated by architecture §6.5 (C4).
//
// M0 contribution: build a slog handler that honours Config.LogLevel / LogFormat
// and strips VAULTCTL_LOG_REDACT_FIELDS from attributes. Full request-body
// redaction arrives with the HTTP middleware in M5.
package logging

import (
	"log/slog"
	"os"
	"strings"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/config"
)

// New returns a redaction-wrapped slog.Logger.
func New(cfg *config.Config) *slog.Logger {
	level := parseLevel(cfg.LogLevel)

	var base slog.Handler
	opts := &slog.HandlerOptions{Level: level}
	switch cfg.LogFormat {
	case "text":
		base = slog.NewTextHandler(os.Stdout, opts)
	default:
		base = slog.NewJSONHandler(os.Stdout, opts)
	}

	return slog.New(&redactHandler{
		inner:   base,
		redacts: buildRedactSet(cfg.LogRedactFields),
	})
}

func parseLevel(raw string) slog.Level {
	switch strings.ToLower(raw) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func buildRedactSet(fields []string) map[string]struct{} {
	out := make(map[string]struct{}, len(fields))
	for _, f := range fields {
		out[strings.ToLower(strings.TrimSpace(f))] = struct{}{}
	}
	return out
}
