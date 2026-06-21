# Email setup

vaultctl can send transactional mail: signup verification, new-device login
alerts, and activity digests. Mail is **off by default**. It stays logged (not
sent) until `VAULTCTL_SMTP_HOST` is set, so a deploy without SMTP is fully
usable and the email-gated features simply skip their gate.

All SMTP vars are in the [configuration reference](configuration.md#email-smtp).

## Configure SMTP

Set at least the host; the rest auth and address your mail:

```bash
VAULTCTL_SMTP_HOST=smtp.example.com
VAULTCTL_SMTP_PORT=587
VAULTCTL_SMTP_USERNAME=apikey-or-user
VAULTCTL_SMTP_PASSWORD=secret
VAULTCTL_SMTP_FROM=vaultctl <no-reply@example.com>
VAULTCTL_SMTP_TLS=starttls
```

`VAULTCTL_SMTP_TLS` picks the transport:

| Mode | Port | Behaviour |
| --- | --- | --- |
| `starttls` | 587 | Connect plaintext, upgrade to TLS. The common choice. |
| `tls` | 465 | Implicit TLS from the first byte. |
| `none` | 25 | No TLS. Local dev or a trusted relay only. |

`VAULTCTL_BASE_URL` must be set for the links in mail to point at your instance.

## Worked example: Gmail

Gmail works as an SMTP relay for low volume. You need an **app password**, not
your account password, and 2-Step Verification must be on for the Google account.

1. Turn on 2-Step Verification, then create an app password at
   <https://myaccount.google.com/apppasswords>.
2. Configure:

   ```bash
   VAULTCTL_SMTP_HOST=smtp.gmail.com
   VAULTCTL_SMTP_PORT=587
   VAULTCTL_SMTP_TLS=starttls
   VAULTCTL_SMTP_USERNAME=you@gmail.com
   VAULTCTL_SMTP_PASSWORD=<16-char app password>
   VAULTCTL_SMTP_FROM=vaultctl <you@gmail.com>
   ```

Gmail's free tier caps outbound at roughly 500 messages/day. Fine for a personal
or small-team instance; use a dedicated provider (e.g. an SMTP relay service) if
you expect more.

## What enabling mail activates

### Signup verification + read-only grace

New accounts get a one-time verification code by email
(`VAULTCTL_EMAIL_OTP_TTL`, default 15m). An unverified account keeps full access
during a grace window (`VAULTCTL_EMAIL_VERIFY_GRACE`, default 7 days); after that
its vault goes read-only (creates, edits, and shares are blocked, reads still
work) until the email is confirmed. Resend has a cooldown
(`VAULTCTL_EMAIL_RESEND_COOLDOWN`, default 60s); a resend inside the window
reuses the live code, so it cannot mail-bomb the inbox or refresh the guess
budget. Endpoints: `POST /api/v1/auth/email/verify`, `POST /api/v1/auth/email/resend`.

### New-device login alerts

On by default (`VAULTCTL_LOGIN_ALERTS_ENABLED=true`). The user is emailed when a
sign-in comes from a device they have not used before. Each user can opt out in
**Settings**.

The separate new-network alert is **off by default**
(`VAULTCTL_LOGIN_ALERT_NEW_NETWORK_ENABLED=false`): the network is a
/24-anonymised IP, so roaming mobile users would otherwise be alerted on nearly
every login. The new-device alert is unaffected by this switch.

### Activity digests

Users opt in to a periodic summary of server-visible activity (logins, items
added, new-device alerts, stale logins) under **Settings**. Configured per user
via `GET`/`PUT /api/v1/users/me/email-preferences`.

Frequencies: `off`, `daily`, `weekly`, `monthly`, `quarterly`, `yearly`.

Each user also picks a granular schedule, interpreted in their own timezone:

| Frequency | Schedule fields used |
| --- | --- |
| daily | hour, minute |
| weekly | weekday, hour, minute |
| monthly | day, hour, minute |
| quarterly | day, hour, minute (every 3 months) |
| yearly | month, day, hour, minute |

Day-of-month is clamped to the month length (day 31 in February lands on the
last day). If a user picks only a frequency and no time, the digest fires
roughly one period after they set it, defaulting to 08:00 in their local zone.

### Localized email (en/de)

Every transactional message (verification, login alert, digest) is rendered in
the recipient's locale. vaultctl ships English and German; the user's locale is
stored on their profile and falls back to English for anything else.
