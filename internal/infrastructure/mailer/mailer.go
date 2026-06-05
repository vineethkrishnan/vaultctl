// SPDX-License-Identifier: AGPL-3.0-or-later

// Package mailer provides transactional email delivery for vaultctl. It offers
// an SMTP adapter (STARTTLS, implicit TLS, or plaintext relay) and a no-op
// logging adapter used when no SMTP host is configured, both satisfying
// ports.Mailer. No third-party dependency: delivery rides on net/smtp.
package mailer

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

// TLSMode selects how the SMTP connection is secured.
type TLSMode string

const (
	TLSStartTLS TLSMode = "starttls" // upgrade a plaintext connection (port 587)
	TLSImplicit TLSMode = "tls"      // TLS from the first byte (port 465)
	TLSNone     TLSMode = "none"     // no TLS (port 25 relay / local dev only)
)

// Config is the SMTP adapter configuration, mapped from server config at wiring.
type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string // "Name <addr@host>" or "addr@host"
	TLSMode  TLSMode
	Timeout  time.Duration
}

// New returns an SMTP mailer when a host is set, otherwise a logging mailer so
// the server runs without mail. An invalid From address also degrades to the
// logger rather than failing startup.
func New(cfg Config) ports.Mailer {
	if cfg.Host == "" {
		slog.Info("mailer.disabled", slog.String("reason", "VAULTCTL_SMTP_HOST not set"))
		return LogMailer{}
	}
	parsed, err := mail.ParseAddress(cfg.From)
	if err != nil {
		slog.Error("mailer.disabled", slog.String("reason", "invalid VAULTCTL_SMTP_FROM"), slog.String("err", err.Error()))
		return LogMailer{}
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	mode := cfg.TLSMode
	if mode == "" {
		mode = TLSStartTLS
	}
	return &SMTPMailer{
		host:       cfg.Host,
		port:       cfg.Port,
		username:   cfg.Username,
		password:   cfg.Password,
		fromHeader: cfg.From,
		fromAddr:   parsed.Address,
		tlsMode:    mode,
		timeout:    timeout,
		now:        time.Now,
	}
}

// SMTPMailer delivers mail over SMTP. Safe for concurrent use.
type SMTPMailer struct {
	host       string
	port       int
	username   string
	password   string
	fromHeader string
	fromAddr   string
	tlsMode    TLSMode
	timeout    time.Duration
	now        func() time.Time
}

func (m *SMTPMailer) Enabled() bool { return true }

func (m *SMTPMailer) Send(ctx context.Context, msg ports.Email) error {
	if msg.To == "" {
		return errors.New("mailer: empty recipient")
	}
	if msg.Text == "" && msg.HTML == "" {
		return errors.New("mailer: empty body")
	}
	raw, err := buildMIME(m.fromHeader, msg.To, msg.Subject, msg.Text, msg.HTML, m.now())
	if err != nil {
		return fmt.Errorf("mailer: build message: %w", err)
	}

	addr := net.JoinHostPort(m.host, strconv.Itoa(m.port))
	conn, err := m.dial(ctx, addr)
	if err != nil {
		return fmt.Errorf("mailer: dial %s: %w", addr, err)
	}
	_ = conn.SetDeadline(m.now().Add(m.timeout))

	client, err := smtp.NewClient(conn, m.host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("mailer: smtp handshake: %w", err)
	}
	defer func() { _ = client.Close() }()

	if m.tlsMode == TLSStartTLS {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return errors.New("mailer: server does not support STARTTLS")
		}
		if err := client.StartTLS(&tls.Config{ServerName: m.host}); err != nil {
			return fmt.Errorf("mailer: starttls: %w", err)
		}
	}
	if m.username != "" {
		if err := client.Auth(smtp.PlainAuth("", m.username, m.password, m.host)); err != nil {
			return fmt.Errorf("mailer: auth: %w", err)
		}
	}
	if err := client.Mail(m.fromAddr); err != nil {
		return fmt.Errorf("mailer: MAIL FROM: %w", err)
	}
	if err := client.Rcpt(msg.To); err != nil {
		return fmt.Errorf("mailer: RCPT TO: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("mailer: DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return fmt.Errorf("mailer: write body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mailer: close body: %w", err)
	}
	return client.Quit()
}

func (m *SMTPMailer) dial(ctx context.Context, addr string) (net.Conn, error) {
	dialer := net.Dialer{Timeout: m.timeout}
	if m.tlsMode == TLSImplicit {
		return tls.DialWithDialer(&dialer, "tcp", addr, &tls.Config{ServerName: m.host})
	}
	return dialer.DialContext(ctx, "tcp", addr)
}

// LogMailer logs that a message would have been sent. Used when SMTP is not
// configured. Bodies are logged only at debug level (an OTP code is sensitive),
// so a dev can still read codes from logs without leaking them in production.
type LogMailer struct{}

func (LogMailer) Enabled() bool { return false }

func (LogMailer) Send(_ context.Context, msg ports.Email) error {
	slog.Info("mailer.log",
		slog.String("to", msg.To),
		slog.String("subject", msg.Subject),
		slog.String("note", "SMTP not configured; message not delivered"),
	)
	slog.Debug("mailer.log.body", slog.String("to", msg.To), slog.String("text", msg.Text))
	return nil
}
