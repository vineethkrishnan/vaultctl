// SPDX-License-Identifier: AGPL-3.0-or-later

package mailer

import (
	"context"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

var fixedDate = time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)

func TestBuildMIME_Multipart(t *testing.T) {
	raw, err := buildMIME("vaultctl <no-reply@example.com>", "user@example.com",
		"Grüße aus vaultctl", "plain body ä", "<p>html body ä</p>", fixedDate)
	if err != nil {
		t.Fatalf("buildMIME: %v", err)
	}

	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	if got := msg.Header.Get("To"); got != "user@example.com" {
		t.Errorf("To = %q", got)
	}
	// Subject is RFC 2047 encoded; decoding must round-trip the umlaut.
	subject, err := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if err != nil || subject != "Grüße aus vaultctl" {
		t.Errorf("Subject = %q (err %v)", subject, err)
	}

	mediaType, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/alternative" {
		t.Fatalf("Content-Type = %q (err %v)", mediaType, err)
	}

	mr := multipart.NewReader(msg.Body, params["boundary"])
	var types []string
	var bodies []string
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("NextPart: %v", err)
		}
		mt, _, _ := mime.ParseMediaType(part.Header.Get("Content-Type"))
		types = append(types, mt)
		decoded, _ := io.ReadAll(quotedprintable.NewReader(part))
		bodies = append(bodies, string(decoded))
	}
	if len(types) != 2 || types[0] != "text/plain" || types[1] != "text/html" {
		t.Fatalf("parts = %v, want [text/plain text/html]", types)
	}
	if bodies[0] != "plain body ä" || bodies[1] != "<p>html body ä</p>" {
		t.Errorf("decoded bodies = %q", bodies)
	}
}

func TestBuildMIME_SingleText(t *testing.T) {
	raw, err := buildMIME("a@b.com", "c@d.com", "Hi", "just text", "", fixedDate)
	if err != nil {
		t.Fatalf("buildMIME: %v", err)
	}
	if !strings.Contains(string(raw), "Content-Type: text/plain; charset=utf-8") {
		t.Errorf("missing text/plain content type:\n%s", raw)
	}
	if strings.Contains(string(raw), "multipart") {
		t.Errorf("unexpected multipart for text-only message")
	}
}

func TestNew_SelectsAdapter(t *testing.T) {
	if _, ok := New(Config{}).(LogMailer); !ok {
		t.Error("empty host should yield LogMailer")
	}
	if _, ok := New(Config{Host: "smtp.example.com", From: "bad-address"}).(LogMailer); !ok {
		t.Error("invalid From should degrade to LogMailer")
	}
	m := New(Config{Host: "smtp.example.com", From: "vaultctl <v@example.com>"})
	if _, ok := m.(*SMTPMailer); !ok {
		t.Errorf("configured host should yield SMTPMailer, got %T", m)
	}
	if !m.Enabled() {
		t.Error("SMTPMailer should report Enabled")
	}
}

func TestLogMailer(t *testing.T) {
	var lm LogMailer
	if lm.Enabled() {
		t.Error("LogMailer must report disabled")
	}
	msg := ports.Email{To: "x@y.com", Subject: "s", Text: "t"}
	if err := lm.Send(context.Background(), msg); err != nil {
		t.Errorf("LogMailer.Send: %v", err)
	}
}
