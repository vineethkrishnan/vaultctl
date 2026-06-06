// SPDX-License-Identifier: AGPL-3.0-or-later

package email

import (
	"fmt"
	"html"
	"strings"
)

const (
	brandAccent = "#0f766e"
	brandInk    = "#18181b"
	brandMuted  = "#52525b"
	pageBg      = "#f4f4f5"
)

// render turns structured content into a plain-text and an inline-styled HTML
// body. HTML email needs inline CSS and table layout for client compatibility,
// so the markup is deliberately verbose and self-contained.
func (s *Service) render(c content) (text string, htmlBody string) {
	return s.renderText(c), s.renderHTML(c)
}

func (s *Service) renderText(c content) string {
	var b strings.Builder
	b.WriteString(c.heading)
	b.WriteString("\n\n")
	for _, p := range c.intro {
		b.WriteString(p)
		b.WriteString("\n\n")
	}
	if c.code != "" {
		b.WriteString("    ")
		b.WriteString(c.code)
		b.WriteString("\n\n")
	}
	if c.ctaLabel != "" && c.ctaURL != "" {
		fmt.Fprintf(&b, "%s: %s\n\n", c.ctaLabel, c.ctaURL)
	}
	for _, p := range c.outro {
		b.WriteString(p)
		b.WriteString("\n\n")
	}
	signoff := c.signoff
	if signoff == "" {
		signoff = "- vaultctl"
	}
	b.WriteString(signoff)
	b.WriteString("\n")
	return b.String()
}

func (s *Service) renderHTML(c content) string {
	var inner strings.Builder
	fmt.Fprintf(&inner, `<h1 style="margin:0 0 16px;font-size:20px;color:%s;">%s</h1>`, brandInk, html.EscapeString(c.heading))
	for _, p := range c.intro {
		fmt.Fprintf(&inner, `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:%s;">%s</p>`, brandMuted, html.EscapeString(p))
	}
	if c.code != "" {
		fmt.Fprintf(&inner, `<div style="margin:8px 0 20px;padding:16px;background:%s;border-radius:10px;text-align:center;font-family:'SFMono-Regular',Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:%s;">%s</div>`, pageBg, brandInk, html.EscapeString(c.code))
	}
	if c.ctaLabel != "" && c.ctaURL != "" {
		fmt.Fprintf(&inner, `<div style="margin:8px 0 20px;"><a href="%s" style="display:inline-block;padding:10px 20px;background:%s;color:#ffffff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">%s</a></div>`,
			html.EscapeString(c.ctaURL), brandAccent, html.EscapeString(c.ctaLabel))
	}
	for _, p := range c.outro {
		fmt.Fprintf(&inner, `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:%s;">%s</p>`, brandMuted, html.EscapeString(p))
	}

	return fmt.Sprintf(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:%s;">`+
		`<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:%s;padding:24px 0;"><tr><td align="center">`+
		`<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%%;background:#ffffff;border-radius:14px;border:1px solid #e4e4e7;">`+
		`<tr><td style="padding:28px 28px 8px;"><div style="font-size:16px;font-weight:700;color:%s;">vaultctl</div></td></tr>`+
		`<tr><td style="padding:8px 28px 24px;">%s</td></tr>`+
		`<tr><td style="padding:16px 28px;border-top:1px solid #f0f0f1;font-size:12px;color:#a1a1aa;">%s</td></tr>`+
		`</table></td></tr></table></body></html>`,
		pageBg, pageBg, brandAccent, inner.String(), html.EscapeString(c.footer))
}
