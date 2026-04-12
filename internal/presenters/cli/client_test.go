package cli

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
