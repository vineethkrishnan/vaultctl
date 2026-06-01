// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	dombackup "github.com/vineethkrishnan/vaultctl/internal/domain/backup"
)

// OAuthConfig is the per-provider OAuth2 configuration. ClientID/ClientSecret
// come from server config; the rest are provider constants.
type OAuthConfig struct {
	ClientID     string
	ClientSecret string
	AuthURL      string
	TokenURL     string
	Scope        string
	// AuthExtra are extra query params on the authorize URL needed to get a
	// durable refresh token (e.g. Google's access_type=offline).
	AuthExtra map[string]string
}

// oauthDefaults holds the provider-constant endpoints and scopes. Credentials
// are filled in from config per request.
var oauthDefaults = map[dombackup.Provider]OAuthConfig{
	dombackup.ProviderGoogleDrive: {
		AuthURL:   "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:  "https://oauth2.googleapis.com/token",
		Scope:     "https://www.googleapis.com/auth/drive.appdata",
		AuthExtra: map[string]string{"access_type": "offline", "prompt": "consent"},
	},
	dombackup.ProviderDropbox: {
		AuthURL:   "https://www.dropbox.com/oauth2/authorize",
		TokenURL:  "https://api.dropboxapi.com/oauth2/token",
		Scope:     "files.content.write files.content.read",
		AuthExtra: map[string]string{"token_access_type": "offline"},
	},
	dombackup.ProviderOneDrive: {
		AuthURL:   "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
		TokenURL:  "https://login.microsoftonline.com/common/oauth2/v2.0/token",
		Scope:     "offline_access Files.ReadWrite.AppFolder",
		AuthExtra: nil,
	},
}

// OAuthProviderConfig merges the provider defaults with the configured client
// credentials. Returns false when the provider is unknown or unconfigured.
func OAuthProviderConfig(provider dombackup.Provider, clientID, clientSecret string) (OAuthConfig, bool) {
	base, ok := oauthDefaults[provider]
	if !ok || clientID == "" || clientSecret == "" {
		return OAuthConfig{}, false
	}
	base.ClientID = clientID
	base.ClientSecret = clientSecret
	return base, true
}

// AuthorizeURL builds the provider authorize URL for the consent redirect.
func (c OAuthConfig) AuthorizeURL(redirectURI, state string) string {
	q := url.Values{}
	q.Set("client_id", c.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("scope", c.Scope)
	q.Set("state", state)
	for k, v := range c.AuthExtra {
		q.Set(k, v)
	}
	return c.AuthURL + "?" + q.Encode()
}

// OAuthToken is the subset of a token response we keep.
type OAuthToken struct {
	AccessToken  string
	RefreshToken string
	Expiry       time.Time
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

func (c OAuthConfig) postToken(ctx context.Context, client *http.Client, form url.Values, now time.Time) (OAuthToken, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return OAuthToken{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return OAuthToken{}, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var tr tokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return OAuthToken{}, fmt.Errorf("oauth: decode token response (status %d)", res.StatusCode)
	}
	if res.StatusCode != http.StatusOK || tr.AccessToken == "" {
		if tr.Error != "" {
			return OAuthToken{}, fmt.Errorf("oauth: %s: %s", tr.Error, tr.ErrorDesc)
		}
		return OAuthToken{}, fmt.Errorf("oauth: token endpoint returned %d", res.StatusCode)
	}
	tok := OAuthToken{AccessToken: tr.AccessToken, RefreshToken: tr.RefreshToken}
	if tr.ExpiresIn > 0 {
		tok.Expiry = now.Add(time.Duration(tr.ExpiresIn) * time.Second)
	}
	return tok, nil
}

// Exchange swaps an authorization code for tokens.
func (c OAuthConfig) Exchange(ctx context.Context, client *http.Client, code, redirectURI string, now time.Time) (OAuthToken, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.ClientSecret)
	return c.postToken(ctx, client, form, now)
}

// Refresh exchanges a refresh token for a fresh access token. Some providers
// (notably Microsoft) rotate the refresh token; the returned token carries the
// new one when present, otherwise the caller keeps the old refresh token.
func (c OAuthConfig) Refresh(ctx context.Context, client *http.Client, refreshToken string, now time.Time) (OAuthToken, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.ClientSecret)
	tok, err := c.postToken(ctx, client, form, now)
	if err != nil {
		return OAuthToken{}, err
	}
	if tok.RefreshToken == "" {
		tok.RefreshToken = refreshToken
	}
	return tok, nil
}
