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
	"time"
)

// httpClient is the single transport used by every CLI command. Dev defaults
// accept self-signed certs because a local vaultctl server is launched via
// HTTPS on localhost; production deployments pin a real CA via the standard
// OS trust store and can set VAULTCTL_INSECURE_SKIP_VERIFY=0.
var httpClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: insecureSkipVerify()}, //nolint:gosec // opt-in via env
	},
}

func insecureSkipVerify() bool {
	// Off-by-default in future, but M10 ships a dev-oriented CLI that
	// must talk to localhost:8080 with a snakeoil cert out of the box.
	v := strings.ToLower(os.Getenv("VAULTCTL_INSECURE_SKIP_VERIFY"))
	return v == "" || v == "1" || v == "true" || v == "yes"
}

// ServerURL returns the configured base URL (no trailing slash).
func ServerURL() string {
	s := os.Getenv(envServer)
	if s == "" {
		s = defaultServerURL
	}
	return strings.TrimRight(s, "/")
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
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return responseBody, parseAPIError(resp.StatusCode, responseBody)
	}
	return responseBody, nil
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
