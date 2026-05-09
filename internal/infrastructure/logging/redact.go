// SPDX-License-Identifier: AGPL-3.0-or-later

package logging

import (
	"context"
	"log/slog"
	"strings"
)

const redacted = "[REDACTED]"

// redactHandler wraps a slog.Handler and strips values for any attribute whose
// key (case-insensitive) appears in the redact set. It walks nested groups.
//
// This is the baseline C4 mitigation at the structured-logger level. HTTP
// middleware performs the same redaction on raw request bodies in M5.
type redactHandler struct {
	inner   slog.Handler
	redacts map[string]struct{}
	groups  []string
}

func (h *redactHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *redactHandler) Handle(ctx context.Context, r slog.Record) error {
	redacted := slog.NewRecord(r.Time, r.Level, r.Message, r.PC)
	r.Attrs(func(a slog.Attr) bool {
		redacted.AddAttrs(h.redactAttr(a))
		return true
	})
	return h.inner.Handle(ctx, redacted)
}

func (h *redactHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	redacted := make([]slog.Attr, len(attrs))
	for i, a := range attrs {
		redacted[i] = h.redactAttr(a)
	}
	return &redactHandler{
		inner:   h.inner.WithAttrs(redacted),
		redacts: h.redacts,
		groups:  h.groups,
	}
}

func (h *redactHandler) WithGroup(name string) slog.Handler {
	return &redactHandler{
		inner:   h.inner.WithGroup(name),
		redacts: h.redacts,
		groups:  append(h.groups, name),
	}
}

func (h *redactHandler) redactAttr(a slog.Attr) slog.Attr {
	if _, hit := h.redacts[strings.ToLower(a.Key)]; hit {
		return slog.String(a.Key, redacted)
	}
	if a.Value.Kind() == slog.KindGroup {
		children := a.Value.Group()
		out := make([]slog.Attr, len(children))
		for i, c := range children {
			out[i] = h.redactAttr(c)
		}
		return slog.Attr{Key: a.Key, Value: slog.GroupValue(out...)}
	}
	return a
}
