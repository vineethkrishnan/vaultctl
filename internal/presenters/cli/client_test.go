// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestHTTP_GetWithBearer(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
	}))
	defer srv.Close()
	t.Setenv(envServer, srv.URL)

	session := &Session{AccessToken: "at-123"}
	raw, err := httpGet("/ping", session)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !strings.Contains(string(raw), "true") {
		t.Errorf("unexpected body: %s", raw)
	}
	if gotAuth != "Bearer at-123" {
		t.Errorf("auth header = %q, want Bearer at-123", gotAuth)
	}
}

func TestHTTP_APIKeyTakesPrecedenceOverAccessToken(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	t.Setenv(envServer, srv.URL)

	session := &Session{APIKey: "pk_test", AccessToken: "at"}
	if _, err := httpGet("/whatever", session); err != nil {
		t.Fatalf("get: %v", err)
	}
	if gotAuth != "Bearer pk_test" {
		t.Errorf("auth = %q, want api key bearer", gotAuth)
	}
}

func TestHTTP_APIErrorStructured(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"nope"}}`))
	}))
	defer srv.Close()
	t.Setenv(envServer, srv.URL)

	_, err := httpPost("/auth/login", map[string]string{"email": "x"}, nil)
	if err == nil {
		t.Fatal("expected error")
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T", err)
	}
	if apiErr.Status != http.StatusUnauthorized || apiErr.Code != "unauthorized" || apiErr.Message != "nope" {
		t.Errorf("unexpected APIError: %+v", apiErr)
	}
	if !IsUnauthorized(err) {
		t.Errorf("IsUnauthorized should be true")
	}
}

func TestServerURL_DefaultAndOverride(t *testing.T) {
	t.Setenv(envServer, "")
	if got := ServerURL(); got != defaultServerURL {
		t.Errorf("default = %q, want %q", got, defaultServerURL)
	}
	t.Setenv(envServer, "https://vault.example.com/")
	if got := ServerURL(); got != "https://vault.example.com" {
		t.Errorf("override + trailing slash trim failed: %q", got)
	}
}

func TestHTTP_RefreshesOnceOn401AndPersistsRotatedTokens(t *testing.T) {
	keyring.MockInit()
	var authHeaders []string
	var refreshBodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/refresh":
			raw, _ := io.ReadAll(r.Body)
			refreshBodies = append(refreshBodies, string(raw))
			_ = json.NewEncoder(w).Encode(map[string]string{
				"accessToken": "at-new", "refreshToken": "rt-new", "refreshExpiresAt": "2030-01-01T00:00:00Z",
			})
		case "/api/v1/items":
			authHeaders = append(authHeaders, r.Header.Get("Authorization"))
			if r.Header.Get("Authorization") != "Bearer at-new" {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"expired"}}`))
				return
			}
			raw, _ := io.ReadAll(r.Body)
			_ = json.NewEncoder(w).Encode(map[string]string{"echo": string(raw)})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	t.Setenv(envServer, srv.URL)
	t.Setenv(envAPIKey, "")

	session := &Session{Email: "a@b.c", AccessToken: "at-old", RefreshToken: "rt-old"}
	raw, err := httpPost("/items", map[string]string{"name": "x"}, session)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if !strings.Contains(string(raw), `{\"name\":\"x\"}`) {
		t.Errorf("retry lost the request body: %s", raw)
	}
	if len(authHeaders) != 2 || authHeaders[0] != "Bearer at-old" || authHeaders[1] != "Bearer at-new" {
		t.Errorf("auth headers = %v", authHeaders)
	}
	if len(refreshBodies) != 1 || !strings.Contains(refreshBodies[0], "rt-old") {
		t.Errorf("refresh bodies = %v", refreshBodies)
	}
	if session.AccessToken != "at-new" || session.RefreshToken != "rt-new" {
		t.Errorf("session not rotated in memory: %+v", session)
	}
	stored, err := LoadSession()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if stored.RefreshToken != "rt-new" || stored.RefreshExpiresAt != "2030-01-01T00:00:00Z" {
		t.Errorf("session not rotated in keychain: %+v", stored)
	}
}

func TestHTTP_RefreshRejectedMeansLoginAgain(t *testing.T) {
	keyring.MockInit()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"gone"}}`))
	}))
	defer srv.Close()
	t.Setenv(envServer, srv.URL)
	t.Setenv(envAPIKey, "")

	_, err := httpGet("/items", &Session{AccessToken: "at", RefreshToken: "rt"})
	if !errors.Is(err, ErrSessionExpired) {
		t.Errorf("err = %v, want ErrSessionExpired", err)
	}
}

func TestHTTP_NoRefreshForAPIKeyOrAuthRoutes(t *testing.T) {
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	t.Setenv(envServer, srv.URL)

	_, _ = httpGet("/items", &Session{APIKey: "pk", RefreshToken: "rt"})
	_, _ = httpPost("/auth/login", map[string]string{}, &Session{AccessToken: "at", RefreshToken: "rt"})
	if len(calls) != 2 {
		t.Errorf("expected exactly one request each, got %v", calls)
	}
}
