// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/application/auth"
)

func TestConfigHandlerFeatures(t *testing.T) {
	deps := Dependencies{
		RegistrationMode: "invite",
		Backup:           &BackupHandlers{},
		Attachment:       &AttachmentHandlers{},
		Notification:     &NotificationHandlers{},
		Update:           &UpdateHandlers{Enabled: true},
		Auth:             &AuthHandlers{VerifyEmail: &auth.VerifyEmail{}},
		MailerEnabled:    true,
		Require2FA:       true,
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	rec := httptest.NewRecorder()
	configHandler(deps).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body struct {
		RegistrationMode string          `json:"registrationMode"`
		Features         *ConfigFeatures `json:"features"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.RegistrationMode != "invite" {
		t.Errorf("registrationMode = %q, want invite", body.RegistrationMode)
	}
	if body.Features == nil {
		t.Fatal("features object missing from /config response")
	}
	want := ConfigFeatures{
		BackupSync:        true,
		Attachments:       true,
		Mailer:            true,
		EmailVerification: true,
		Updates:           true,
		Notifications:     true,
		Require2FA:        true,
	}
	if *body.Features != want {
		t.Errorf("features = %+v, want %+v", *body.Features, want)
	}
}

func TestConfigHandlerFeaturesAllOff(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	rec := httptest.NewRecorder()
	configHandler(Dependencies{}).ServeHTTP(rec, req)

	var body struct {
		Features *ConfigFeatures `json:"features"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Features == nil {
		t.Fatal("features object missing")
	}
	if (*body.Features != ConfigFeatures{}) {
		t.Errorf("expected all features off, got %+v", *body.Features)
	}
}
