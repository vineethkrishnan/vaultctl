// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	dombackup "github.com/vineethkrishnan/vaultctl/internal/domain/backup"
)

var _ ports.BackupConnector = (*Connector)(nil)

// Connector runs the OAuth consent + code exchange for cloud providers using
// the configured client credentials.
type Connector struct {
	HTTPClient   *http.Client
	Clock        func() time.Time
	OAuthClients map[dombackup.Provider]OAuthClient
}

func (c *Connector) config(provider dombackup.Provider) (OAuthConfig, error) {
	creds, ok := c.OAuthClients[provider]
	if !ok {
		return OAuthConfig{}, fmt.Errorf("%w: %s", ErrProviderUnavailable, provider)
	}
	cfg, ok := OAuthProviderConfig(provider, creds.ClientID, creds.ClientSecret)
	if !ok {
		return OAuthConfig{}, fmt.Errorf("%w: %s", ErrProviderUnavailable, provider)
	}
	return cfg, nil
}

func (c *Connector) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

func (c *Connector) now() time.Time {
	if c.Clock != nil {
		return c.Clock()
	}
	return time.Now()
}

func (c *Connector) AuthorizeURL(provider dombackup.Provider, redirectURI, state string) (string, error) {
	cfg, err := c.config(provider)
	if err != nil {
		return "", err
	}
	return cfg.AuthorizeURL(redirectURI, state), nil
}

func (c *Connector) Exchange(ctx context.Context, provider dombackup.Provider, code, redirectURI string) (string, error) {
	cfg, err := c.config(provider)
	if err != nil {
		return "", err
	}
	tok, err := cfg.Exchange(ctx, c.httpClient(), code, redirectURI, c.now())
	if err != nil {
		return "", err
	}
	if tok.RefreshToken == "" {
		return "", fmt.Errorf("backup: provider %s returned no refresh token (consent may need offline access)", provider)
	}
	return tok.RefreshToken, nil
}
