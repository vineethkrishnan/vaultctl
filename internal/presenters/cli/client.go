// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

var (
	httpClientOnce sync.Once
	httpClient     *http.Client
)

// client is the single transport used by every CLI command. Certificate
// verification is on unless the user opted out, or the server is loopback
// (a local `vaultctl server` runs on a self-signed certificate).
func client() *http.Client {
	httpClientOnce.Do(func() {
		httpClient = &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: insecureSkipVerify()}, //nolint:gosec // opt-in via env or config, default only for loopback
			},
		}
	})
	return httpClient
}

func insecureSkipVerify() bool {
	if value := strings.ToLower(os.Getenv(envInsecureSkipVerify)); value != "" {
		return value == "1" || value == "true" || value == "yes"
	}
	if configured := loadConfig().InsecureSkipVerify; configured != nil {
		return *configured
	}
	return isLoopbackServer(ServerURL())
}

// ServerURL returns the base URL (no trailing slash): VAULTCTL_SERVER, then
// the config file, then the local development default.
func ServerURL() string {
	server := os.Getenv(envServer)
	if server == "" {
		server = loadConfig().Server
	}
	if server == "" {
		server = defaultServerURL
	}
	return strings.TrimRight(server, "/")
}

// APIError is the decoded { "error": { "code", "message" } } shape from the
// server's error body.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("server error %d (%s): %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("server error %d: %s", e.Status, e.Message)
}

// do executes an HTTP request against /api/v1{path}, decoding the JSON body
// on success and surfacing a structured APIError on non-2xx.
func do(method, path string, body any, session *Session) ([]byte, error) {
	url := ServerURL() + "/api/v1" + path
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if session != nil {
		switch {
		case session.APIKey != "":
			req.Header.Set("Authorization", "Bearer "+session.APIKey)
		case session.AccessToken != "":
			req.Header.Set("Authorization", "Bearer "+session.AccessToken)
		}
	}
	status, responseBody, err := send(req)
	if err != nil {
		return nil, err
	}
	if status == http.StatusUnauthorized && canRefresh(session, path) {
		if err := refreshSession(session); err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+session.AccessToken)
		if req.GetBody != nil {
			if req.Body, err = req.GetBody(); err != nil {
				return nil, err
			}
		}
		status, responseBody, err = send(req)
		if err != nil {
			return nil, err
		}
	}
	if status < 200 || status >= 300 {
		return responseBody, parseAPIError(status, responseBody)
	}
	return responseBody, nil
}

func send(req *http.Request) (int, []byte, error) {
	resp, err := client().Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("http: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, fmt.Errorf("read body: %w", err)
	}
	return resp.StatusCode, responseBody, nil
}

// canRefresh limits the transparent retry to keychain sessions that hold a
// refresh token, and never to the auth endpoints themselves (a 401 from
// /auth/login or /auth/refresh is the real answer, not a stale token).
func canRefresh(session *Session, path string) bool {
	if session == nil || session.APIKey != "" || session.RefreshToken == "" {
		return false
	}
	return !strings.HasPrefix(path, "/auth/")
}

// ErrSessionExpired is returned when the refresh token itself was rejected,
// which means the user has to log in again.
var ErrSessionExpired = errors.New("session expired; run `vaultctl login`")

// refreshSession rotates the access/refresh token pair and persists the new
// pair in the keychain so the next invocation starts from the fresh tokens.
func refreshSession(session *Session) error {
	raw, err := json.Marshal(map[string]string{"refreshToken": session.RefreshToken})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, ServerURL()+"/api/v1/auth/refresh", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	status, responseBody, err := send(req)
	if err != nil {
		return err
	}
	if status == http.StatusUnauthorized {
		return ErrSessionExpired
	}
	if status < 200 || status >= 300 {
		return parseAPIError(status, responseBody)
	}
	var rotated struct {
		AccessToken      string `json:"accessToken"`
		RefreshToken     string `json:"refreshToken"`
		RefreshExpiresAt string `json:"refreshExpiresAt"`
	}
	if err := unmarshalJSON(responseBody, &rotated); err != nil {
		return err
	}
	session.AccessToken = rotated.AccessToken
	session.RefreshToken = rotated.RefreshToken
	session.RefreshExpiresAt = rotated.RefreshExpiresAt
	return SaveSession(session)
}

// Get issues GET {path} with the session's bearer token.
func httpGet(path string, session *Session) ([]byte, error) {
	return do(http.MethodGet, path, nil, session)
}

// Post issues POST {path} with a JSON body.
func httpPost(path string, body any, session *Session) ([]byte, error) {
	return do(http.MethodPost, path, body, session)
}

// Put issues PUT {path} with a JSON body.
func httpPut(path string, body any, session *Session) ([]byte, error) {
	return do(http.MethodPut, path, body, session)
}

// Delete issues DELETE {path} - body is optional.
func httpDelete(path string, body any, session *Session) ([]byte, error) {
	return do(http.MethodDelete, path, body, session)
}

func parseAPIError(status int, raw []byte) error {
	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil && envelope.Error.Message != "" {
		return &APIError{Status: status, Code: envelope.Error.Code, Message: envelope.Error.Message}
	}
	return &APIError{Status: status, Message: strings.TrimSpace(string(raw))}
}

// unmarshalJSON is a thin wrapper around json.Unmarshal that returns a
// contextual error when the server sends a surprising body.
func unmarshalJSON(raw []byte, v any) error {
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("decode response: %w (body=%q)", err, string(raw))
	}
	return nil
}

// IsUnauthorized reports whether err is an APIError with 401/403.
func IsUnauthorized(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.Status == http.StatusUnauthorized || apiErr.Status == http.StatusForbidden
	}
	return false
}
