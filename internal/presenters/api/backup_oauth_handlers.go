// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/vineethkrishnan/vaultctl/internal/application/audit"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	dombackup "github.com/vineethkrishnan/vaultctl/internal/domain/backup"
	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// BackupOAuthHandlers run the connect (consent) and callback (code-exchange)
// flow for cloud providers. State is sealed with the server data key and
// carries the user, provider and an expiry, so the unauthenticated callback can
// safely attribute the connection.
type BackupOAuthHandlers struct {
	Connector    ports.BackupConnector
	Sealer       ports.Sealer
	Destinations ports.BackupDestinationRepository
	Clock        ports.Clock
	IDs          ports.IDGenerator
	BaseURL      string
	Audit        *audit.Writer
}

const oauthStateTTL = 10 * time.Minute

var oauthStateAAD = []byte("backup:oauth:state")

type oauthState struct {
	UserID   string `json:"u"`
	Provider string `json:"p"`
	Exp      int64  `json:"e"`
}

func (h *BackupOAuthHandlers) redirectURI(provider string) string {
	return strings.TrimRight(h.BaseURL, "/") + "/api/v1/backup/oauth/" + provider + "/callback"
}

func (h *BackupOAuthHandlers) sealState(s oauthState) (string, error) {
	plain, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	blob, err := h.Sealer.Encrypt(plain, oauthStateAAD)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(blob.Bytes()), nil
}

func (h *BackupOAuthHandlers) openState(encoded string) (oauthState, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return oauthState{}, err
	}
	blob, err := domaincrypto.ParseBlob(raw)
	if err != nil {
		return oauthState{}, err
	}
	plain, err := h.Sealer.Decrypt(blob, oauthStateAAD)
	if err != nil {
		return oauthState{}, err
	}
	var s oauthState
	if err := json.Unmarshal(plain, &s); err != nil {
		return oauthState{}, err
	}
	return s, nil
}

// HandleStart begins an OAuth connect and returns the provider consent URL.
func (h *BackupOAuthHandlers) HandleStart(w http.ResponseWriter, r *http.Request) {
	caller := middleware.CallerID(r.Context())
	provider := chi.URLParam(r, "provider")
	state, err := h.sealState(oauthState{
		UserID:   string(caller),
		Provider: provider,
		Exp:      h.Clock.Now().Add(oauthStateTTL).Unix(),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	authURL, err := h.Connector.AuthorizeURL(
		dombackup.Provider(provider), h.redirectURI(provider), state,
	)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"authUrl": authURL})
}

// HandleCallback completes the OAuth flow: it verifies the sealed state,
// exchanges the code for a refresh token, creates a (manual-frequency)
// destination for the user, and redirects back to the settings page.
func (h *BackupOAuthHandlers) HandleCallback(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	settingsURL := strings.TrimRight(h.BaseURL, "/") + "/settings"

	fail := func(reason string) {
		http.Redirect(w, r, settingsURL+"?backup=error&reason="+reason, http.StatusFound)
	}

	if errParam := r.URL.Query().Get("error"); errParam != "" {
		fail("denied")
		return
	}
	code := r.URL.Query().Get("code")
	state, err := h.openState(r.URL.Query().Get("state"))
	if err != nil || code == "" {
		fail("invalid_state")
		return
	}
	if state.Provider != provider || h.Clock.Now().Unix() > state.Exp {
		fail("expired")
		return
	}

	refreshToken, err := h.Connector.Exchange(
		r.Context(), dombackup.Provider(provider), code, h.redirectURI(provider),
	)
	if err != nil {
		fail("exchange_failed")
		return
	}

	now := h.Clock.Now()
	dest := dombackup.Destination{
		ID:            h.IDs.NewID(),
		UserID:        state.UserID,
		Provider:      dombackup.Provider(provider),
		Label:         providerLabel(provider),
		Settings:      map[string]string{"refresh_token": refreshToken},
		Frequency:     dombackup.FrequencyOff,
		RetentionKeep: 7,
		Enabled:       true,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := h.Destinations.Create(r.Context(), dest); err != nil {
		fail("save_failed")
		return
	}
	h.Audit.BackupConfigured(r.Context(), state.UserID, dest.ID, middleware.ClientIP(r), r.UserAgent())
	http.Redirect(w, r, settingsURL+"?backup=connected", http.StatusFound)
}

func providerLabel(provider string) string {
	switch provider {
	case "gdrive":
		return "Google Drive"
	case "dropbox":
		return "Dropbox"
	case "onedrive":
		return "OneDrive"
	default:
		return provider
	}
}
