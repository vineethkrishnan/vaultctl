// SPDX-License-Identifier: AGPL-3.0-or-later

package email

import (
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// catalog holds every user-facing string for one locale. The German copy is
// machine-drafted and follows the web app's conventions (formal "Sie",
// "Tresor" for vault); it should be reviewed by a native speaker.
type catalog struct {
	// Shared layout.
	footer string
	// Sign-off appended to every message body.
	signoff string

	// Verification email.
	verifySubject string
	verifyHeading string
	verifyIntro   string
	// verifyOutro takes the humanized TTL (already localized).
	verifyOutro func(ttl string) string

	// Login-alert email.
	loginSubject     string
	loginHeading     string
	loginNewSignin   string // generic "a new sign-in"
	loginNewDevice   string // "a sign-in from a new device"
	loginNewNetwork  string // "a sign-in from a new network"
	loginHappened    func(what string) string
	loginDeviceLabel string // "Device: " prefix
	loginWhenLabel   string // "When: " prefix
	loginIPLabel     string // "IP address: " prefix
	loginUnknownIP   string
	loginCTA         string
	loginOutroOK     string
	loginOutroAct    string

	// Digest email.
	digestSubject  func(period string) string
	digestHeading  func(period string) string
	digestIntro    string
	digestLogins   func(n int) string
	digestDevices  func(n int) string
	digestItems    func(n int) string
	digestStale    func(n int) string
	digestSettings string
	digestCTA      string

	// humanizeDuration renders a TTL in this locale's words.
	humanizeDuration func(d time.Duration) string
	// period renders a frequency key ("daily"/"weekly"/...) in this locale.
	period func(key string) string
}

// catalogFor returns the catalog for the given locale, falling back to English.
func catalogFor(locale string) catalog {
	if user.NormalizeLocale(locale) == user.LocaleDE {
		return germanCatalog
	}
	return englishCatalog
}

var englishCatalog = catalog{
	footer:  "You're receiving this because of activity on your vaultctl account.",
	signoff: "- vaultctl",

	verifySubject: "Your vaultctl verification code",
	verifyHeading: "Confirm your email",
	verifyIntro:   "Enter this code in vaultctl to confirm your email address and activate your account.",
	verifyOutro: func(ttl string) string {
		return fmt.Sprintf("The code expires in %s. If you didn't create a vaultctl account, you can ignore this email.", ttl)
	},

	loginSubject:     "New sign-in to your vaultctl account",
	loginHeading:     "New sign-in to your vault",
	loginNewSignin:   "A new sign-in",
	loginNewDevice:   "A sign-in from a new device",
	loginNewNetwork:  "A sign-in from a new network",
	loginHappened:    func(what string) string { return what + " just happened on your vaultctl account." },
	loginDeviceLabel: "Device: ",
	loginWhenLabel:   "When: ",
	loginIPLabel:     "IP address: ",
	loginUnknownIP:   "unknown",
	loginCTA:         "Review your sessions",
	loginOutroOK:     "If this was you, no action is needed.",
	loginOutroAct:    "If you don't recognise it, change your master password and sign out other sessions right away.",

	digestSubject: func(period string) string { return "Your vaultctl " + period + " digest" },
	digestHeading: func(period string) string { return "Your vaultctl " + period + " digest" },
	digestIntro:   "Here's what happened on your account:",
	digestLogins:  func(n int) string { return fmt.Sprintf("Sign-ins: %d", n) },
	digestDevices: func(n int) string { return fmt.Sprintf("New devices or networks: %d", n) },
	digestItems:   func(n int) string { return fmt.Sprintf("Items added: %d", n) },
	digestStale: func(n int) string {
		return fmt.Sprintf("%d login%s haven't been updated in over a year. Consider rotating those passwords.", n, enPlural(n))
	},
	digestSettings: "You can change how often you receive this in vaultctl settings.",
	digestCTA:      "Open vaultctl",

	humanizeDuration: humanizeDurationEN,
	period:           periodEN,
}

var germanCatalog = catalog{
	footer:  "Sie erhalten diese E-Mail aufgrund von Aktivitäten in Ihrem vaultctl-Konto.",
	signoff: "- vaultctl",

	verifySubject: "Ihr vaultctl-Bestätigungscode",
	verifyHeading: "Bestätigen Sie Ihre E-Mail-Adresse",
	verifyIntro:   "Geben Sie diesen Code in vaultctl ein, um Ihre E-Mail-Adresse zu bestätigen und Ihr Konto zu aktivieren.",
	verifyOutro: func(ttl string) string {
		return fmt.Sprintf("Der Code läuft in %s ab. Wenn Sie kein vaultctl-Konto erstellt haben, können Sie diese E-Mail ignorieren.", ttl)
	},

	loginSubject:     "Neue Anmeldung bei Ihrem vaultctl-Konto",
	loginHeading:     "Neue Anmeldung bei Ihrem Tresor",
	loginNewSignin:   "Eine neue Anmeldung",
	loginNewDevice:   "Eine Anmeldung von einem neuen Gerät",
	loginNewNetwork:  "Eine Anmeldung aus einem neuen Netzwerk",
	loginHappened:    func(what string) string { return what + " ist soeben bei Ihrem vaultctl-Konto erfolgt." },
	loginDeviceLabel: "Gerät: ",
	loginWhenLabel:   "Zeitpunkt: ",
	loginIPLabel:     "IP-Adresse: ",
	loginUnknownIP:   "unbekannt",
	loginCTA:         "Ihre Sitzungen überprüfen",
	loginOutroOK:     "Wenn Sie das waren, ist nichts weiter zu tun.",
	loginOutroAct:    "Falls Sie die Anmeldung nicht erkennen, ändern Sie umgehend Ihr Master-Passwort und melden Sie alle anderen Sitzungen ab.",

	digestSubject: func(period string) string { return "Ihre vaultctl-Zusammenfassung (" + period + ")" },
	digestHeading: func(period string) string { return "Ihre vaultctl-Zusammenfassung (" + period + ")" },
	digestIntro:   "Das ist in Ihrem Konto passiert:",
	digestLogins:  func(n int) string { return fmt.Sprintf("Anmeldungen: %d", n) },
	digestDevices: func(n int) string { return fmt.Sprintf("Neue Geräte oder Netzwerke: %d", n) },
	digestItems:   func(n int) string { return fmt.Sprintf("Hinzugefügte Einträge: %d", n) },
	digestStale: func(n int) string {
		if n == 1 {
			return "1 Anmeldung wurde seit über einem Jahr nicht aktualisiert. Erwägen Sie, dieses Passwort zu ändern."
		}
		return fmt.Sprintf("%d Anmeldungen wurden seit über einem Jahr nicht aktualisiert. Erwägen Sie, diese Passwörter zu ändern.", n)
	},
	digestSettings: "Sie können in den vaultctl-Einstellungen festlegen, wie oft Sie diese Zusammenfassung erhalten.",
	digestCTA:      "vaultctl öffnen",

	humanizeDuration: humanizeDurationDE,
	period:           periodDE,
}

func enPlural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func humanizeDurationEN(d time.Duration) string {
	if d >= time.Hour && d%time.Hour == 0 {
		h := int(d / time.Hour)
		if h == 1 {
			return "1 hour"
		}
		return fmt.Sprintf("%d hours", h)
	}
	m := int(d / time.Minute)
	if m <= 1 {
		return "1 minute"
	}
	return fmt.Sprintf("%d minutes", m)
}

func humanizeDurationDE(d time.Duration) string {
	if d >= time.Hour && d%time.Hour == 0 {
		h := int(d / time.Hour)
		if h == 1 {
			return "1 Stunde"
		}
		return fmt.Sprintf("%d Stunden", h)
	}
	m := int(d / time.Minute)
	if m <= 1 {
		return "1 Minute"
	}
	return fmt.Sprintf("%d Minuten", m)
}

const (
	periodDaily     = "daily"
	periodWeekly    = "weekly"
	periodMonthly   = "monthly"
	periodQuarterly = "quarterly"
	periodYearly    = "yearly"
)

func periodEN(key string) string {
	switch key {
	case periodDaily:
		return periodDaily
	case periodWeekly:
		return periodWeekly
	case periodMonthly:
		return periodMonthly
	case periodQuarterly:
		return periodQuarterly
	case periodYearly:
		return periodYearly
	default:
		return key
	}
}

func periodDE(key string) string {
	switch key {
	case periodDaily:
		return "täglich"
	case periodWeekly:
		return "wöchentlich"
	case periodMonthly:
		return "monatlich"
	case periodQuarterly:
		return "vierteljährlich"
	case periodYearly:
		return "jährlich"
	default:
		return key
	}
}
