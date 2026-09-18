// SPDX-License-Identifier: AGPL-3.0-or-later

package run

import (
	"regexp"
	"strings"
)

// Kind is the credential a prompt is asking for.
type Kind int

const (
	KindNone Kind = iota
	KindUsername
	KindPassword
	KindTOTP
)

func (k Kind) String() string {
	switch k {
	case KindUsername:
		return "username"
	case KindPassword:
		return "password"
	case KindTOTP:
		return "totp"
	default:
		return "none"
	}
}

var (
	otpRe      = regexp.MustCompile(`(?i)\b(otp|one[- ]?time|token|mfa|2fa|verification|authenticator|passcode|code)\b`)
	usernameRe = regexp.MustCompile(`(?i)\b(user ?name|user|login|email|account)\b`)
	passwordRe = regexp.MustCompile(`(?i)pass(word|phrase)?\b`)
	ansiRe     = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]`)
)

// Classify decides what a prompt asks for. secret is true when the program
// turned terminal echo off for the answer, which is the strongest signal
// there is: any such prompt is a password unless it talks about a code. A
// visible prompt only counts when it ends like a question and names a
// username or a code, so ordinary program output is never answered.
func Classify(prompt string, secret bool) Kind {
	text := strings.TrimSpace(StripANSI(prompt))
	if text == "" {
		if secret {
			return KindPassword
		}
		return KindNone
	}
	if secret {
		if otpRe.MatchString(text) && !passwordRe.MatchString(text) {
			return KindTOTP
		}
		return KindPassword
	}
	if !strings.HasSuffix(text, ":") && !strings.HasSuffix(text, "?") && !strings.HasSuffix(text, ">") {
		return KindNone
	}
	if otpRe.MatchString(text) {
		return KindTOTP
	}
	if usernameRe.MatchString(text) && !passwordRe.MatchString(text) {
		return KindUsername
	}
	return KindNone
}

// StripANSI removes CSI/OSC escape sequences and carriage returns so prompt
// text can be matched as plain words.
func StripANSI(s string) string {
	return strings.ReplaceAll(ansiRe.ReplaceAllString(s, ""), "\r", "")
}

// LastLine returns the trailing line of an output buffer, escape-free.
func LastLine(output []byte) string {
	clean := StripANSI(string(output))
	if index := strings.LastIndexByte(clean, '\n'); index >= 0 {
		clean = clean[index+1:]
	}
	return strings.TrimSpace(clean)
}
