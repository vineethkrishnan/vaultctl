# Configuration reference

Every server setting is an environment variable with the `VAULTCTL_` prefix. The
server parses them once at startup (`internal/infrastructure/config/config.go`).
In `VAULTCTL_ENV=production` the load-bearing secrets have no defaults and the
server refuses to start if any is missing (fail-closed). Those are flagged
**Required (prod)** below. In production the server also rejects secrets that
are present but too short: JWT signing secrets must be at least 32 characters
and the peppers at least 16. The generation commands below produce values well
above those floors, so any setup following this guide clears them.

Generate secret values with:

```bash
openssl rand -base64 32   # 32-byte values (data key, peppers)
openssl rand -base64 64   # JWT secrets
```

Durations use Go syntax (`15m`, `168h`, `15s`). Lists are comma-separated.

## Server

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_PORT` | `8080` | TCP port the HTTP server listens on. |
| `VAULTCTL_HOST` | `0.0.0.0` | Bind address. |
| `VAULTCTL_BASE_URL` | (none) | Public origin, e.g. `https://vault.example.com`. Used in email links and as the OAuth redirect base. Must be http(s). **Required (prod).** |
| `VAULTCTL_ENV` | `development` | `production` or `development`. `production` turns on fail-closed secret validation. |

## Database

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_DB_HOST` | `localhost` | Postgres host. |
| `VAULTCTL_DB_PORT` | `5432` | Postgres port. |
| `VAULTCTL_DB_NAME` | `vaultctl` | Database name. |
| `VAULTCTL_DB_USER` | `vaultctl` | Database user. |
| `VAULTCTL_DB_PASSWORD` | (none) | Database password. **Required (prod).** |
| `VAULTCTL_DB_SSL_MODE` | `require` | `require`, `verify-full`, or `disable`. Use `verify-full` for any cross-host DB. |
| `VAULTCTL_DB_SSL_INSECURE_OK` | `false` | Explicit opt-in to allow `VAULTCTL_DB_SSL_MODE=disable` in production. Only set when Postgres is on a private bridge network (the bundled compose does this). In prod, `disable` without this set fails startup. |

## JWT signing keys (dual-key rotation)

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_JWT_SECRET_CURRENT` | (none) | Active token-signing secret. **Required (prod).** |
| `VAULTCTL_JWT_SECRET_NEXT` | (none) | Next secret for zero-downtime rotation. Tokens signed with either are accepted. |
| `VAULTCTL_JWT_KID_CURRENT` | `k1` | Key id stamped into freshly issued tokens. |
| `VAULTCTL_JWT_ACCESS_TTL` | `15m` | Access-token lifetime. |
| `VAULTCTL_JWT_REFRESH_TTL` | `168h` | Refresh-token lifetime (7 days). |

## Server-side data encryption key

Encrypts server-held secrets (TOTP secret, password hint) and seals backup
artifacts and OAuth tokens. Store it somewhere different from your DB backups.

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_DATA_ENCRYPTION_KEY` | (none) | Server data-encryption key. **Required (prod).** |
| `VAULTCTL_DATA_ENCRYPTION_KEY_NEXT` | (none) | Next data key for rotation. |

## Server peppers

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_SERVER_PEPPER` | (none) | Pepper mixed into the stored auth hash. **Required (prod).** |
| `VAULTCTL_ENUMERATION_PEPPER` | (none) | Pepper for constant-shape responses that resist user enumeration. **Required (prod).** |

## Security

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_REGISTRATION_MODE` | `invite` | `open`, `invite`, or `disabled`. The first registration on an empty database is always allowed and becomes owner; the mode applies from the second user on. |
| `VAULTCTL_REQUIRE_2FA` | `false` | When true, accounts without TOTP enabled are read-only (reads and the TOTP enrolment routes stay open so they can unblock themselves). |
| `VAULTCTL_HIBP_ENABLED` | `false` | Lets the client offer an opt-in Have I Been Pwned breach check (k-anonymity range query, run client-side; the server never calls HIBP). Off by default so air-gapped deploys never phone home. |
| `VAULTCTL_MAX_LOGIN_ATTEMPTS` | `5` | Failed-login attempts before lockout. |
| `VAULTCTL_LOCKOUT_DURATION` | `15m` | Lockout window after too many failures. |
| `VAULTCTL_RATE_LIMIT_RPM` | `60` | Per-IP request budget per minute. |
| `VAULTCTL_AUTH_RATE_LIMIT_PER_EMAIL` | `5` | Credential-endpoint attempts allowed per email per window. |
| `VAULTCTL_AUTH_RATE_LIMIT_WINDOW` | `15m` | Window for the per-email auth limit. |
| `VAULTCTL_AUTH_GLOBAL_ALERT_THRESHOLD` | `1000` | Global auth-failure count that raises an alert (credential-stuffing signal). |
| `VAULTCTL_TRUSTED_PROXIES` | loopback + RFC1918 | CIDRs trusted to set `X-Forwarded-For`. Tighten to your proxy when it has a public IP; an empty list disables XFF entirely. |
| `VAULTCTL_STEP_UP_MAX_AGE` | `5m` | How long a step-up re-auth stays valid for sensitive actions (purge, export, password change). |
| `VAULTCTL_CORS_ALLOWED_ORIGINS` | (none) | Comma-separated allowed CORS origins. Set this if the extension or a separate frontend origin needs cross-origin access. |

## Update check

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_UPDATE_CHECK_ENABLED` | `true` | When on, the server polls the GitHub Releases API of `UPDATE_REPO` (one outbound call per cache window, server-side only) and serves the result at `GET /api/v1/updates`. |
| `VAULTCTL_UPDATE_REPO` | `vineethkrishnan/vaultctl` | Repo to check for newer releases. |
| `VAULTCTL_UPDATE_CHECK_INTERVAL` | `15m` | Cache window / poll interval. |
| `VAULTCTL_UPDATE_ROLLOUT_DELAY` | `0` | Withholds the update alert from clients until this long after a release publish time (staged rollout). `0` reveals immediately. |

## In-app upgrade

Lets admin users apply a new release with a single click from the update banner or
Settings without SSHing into the host. Disabled by default. Set exactly one of
`VAULTCTL_UPGRADE_HOOK_URL` or `VAULTCTL_UPGRADE_HOOK_SCRIPT` alongside
`VAULTCTL_UPGRADE_ENABLED=true`.

The server never pulls images or modifies its own binary. It calls out to an
external mechanism (Watchtower, a shell script) that does the work and then
restarts the container. Migrations run automatically on the next startup because
the bundled compose uses `vaultctl migrate up && exec vaultctl server` as the
container command.

**Watchtower (recommended for Docker Compose)**

```bash
# In .env
VAULTCTL_UPGRADE_ENABLED=true
VAULTCTL_UPGRADE_HOOK_URL=http://watchtower:8080/v1/update
VAULTCTL_UPGRADE_HOOK_TOKEN=<secret-matching-WATCHTOWER_HTTP_API_TOKEN>
```

Uncomment the `watchtower` service block in `docker-compose.yml`. The Watchtower
container must be on the same Docker network as vaultctl and must be started with
`--http-api-update`.

**Custom script**

```bash
# In .env
VAULTCTL_UPGRADE_ENABLED=true
VAULTCTL_UPGRADE_HOOK_SCRIPT=/usr/local/bin/vaultctl-upgrade.sh
```

The script is exec'd directly (no shell expansion). It should pull the new image,
stop the old container, start the new one, and exit 0 on success. stdout/stderr
are streamed live to the admin UI as the upgrade runs.

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_UPGRADE_ENABLED` | `false` | Gates the `POST /api/v1/updates/apply` endpoint. Off by default; must be explicitly opted in. Requires admin + step-up re-auth. |
| `VAULTCTL_UPGRADE_HOOK_URL` | (none) | Full URL of an HTTP endpoint to POST to when an upgrade is triggered (e.g. `http://watchtower:8080/v1/update`). Takes precedence over `HOOK_SCRIPT` if both are set. |
| `VAULTCTL_UPGRADE_HOOK_TOKEN` | (none) | Bearer token sent to the hook URL. Must match the Watchtower `WATCHTOWER_HTTP_API_TOKEN` value. |
| `VAULTCTL_UPGRADE_HOOK_SCRIPT` | (none) | Absolute path to an executable script on the host. The server exec's it directly; no shell expansion. |

## Email (SMTP)

Mail is disabled (logged, not sent) until `VAULTCTL_SMTP_HOST` is set, so a deploy
without SMTP stays usable and the email-gated features simply skip their gate.
See [email.md](email.md) for a worked setup.

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_SMTP_HOST` | (none) | SMTP server host. Setting this enables transactional mail. |
| `VAULTCTL_SMTP_PORT` | `587` | SMTP port. |
| `VAULTCTL_SMTP_USERNAME` | (none) | SMTP auth username. |
| `VAULTCTL_SMTP_PASSWORD` | (none) | SMTP auth password (use an app password where the provider offers one). |
| `VAULTCTL_SMTP_FROM` | `vaultctl <no-reply@localhost>` | From header on outbound mail. |
| `VAULTCTL_SMTP_TLS` | `starttls` | `starttls` (587), `tls` (implicit, 465), or `none` (port 25 / local dev only). |
| `VAULTCTL_SMTP_TIMEOUT` | `15s` | Send timeout. |
| `VAULTCTL_EMAIL_OTP_TTL` | `15m` | Lifetime of a signup verification code. |
| `VAULTCTL_EMAIL_RESEND_COOLDOWN` | `60s` | Minimum gap between verification-code sends per user. A resend inside the window reuses the live code (cannot mail-bomb or refresh the guess budget). |
| `VAULTCTL_EMAIL_VERIFY_GRACE` | `168h` | How long an unverified account keeps full access before its vault becomes read-only (7 days). Only enforced when a mailer is configured. |
| `VAULTCTL_LOGIN_ALERTS_ENABLED` | `true` | Emails the user on a sign-in from a new device or network. Only active with a mailer; users can opt out in settings. |
| `VAULTCTL_LOGIN_ALERT_NEW_NETWORK_ENABLED` | `false` | Controls the new-network alert specifically. Off by default because the network is a /24-anonymised IP and roaming mobile users would otherwise get alerted on nearly every login. The new-device alert stays on regardless. |
| `VAULTCTL_KNOWN_LOGIN_RETENTION` | `8760h` | How long a known-login row (one per distinct device/network) is kept before the purge job deletes it (1 year). |

## Retention

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_TRASH_RETENTION_DAYS` | `30` | Days a trashed item survives before it is eligible for purge. |
| `VAULTCTL_BACKUP_RETENTION_DAYS` | `90` | Retention for the admin `vaultctl backup` dumps. |

## Backup sync (per-user scheduled destinations)

The artifact is the user's client-encrypted export, sealed again with the server
data key before it leaves the box. Local, S3, and WebDAV need no server config
(users supply their own credentials); cloud OAuth providers activate only when
their client id/secret are set. See [backup-sync.md](backup-sync.md).

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_BACKUP_SYNC_ENABLED` | `true` | Master switch for per-user backup destinations. |
| `VAULTCTL_BACKUP_LOCAL_DIR` | `/data/backups` | Filesystem directory the local destination writes to. |
| `VAULTCTL_BACKUP_ALLOW_PRIVATE` | `true` | Whether WebDAV/S3 destinations may target RFC1918 / ULA private addresses. Keep `true` for single-owner self-hosting (a LAN Nextcloud/MinIO is a valid target). Set `false` on multi-user instances so a member can't aim a destination at internal LAN services. Loopback, link-local, and cloud-metadata addresses are blocked either way. |
| `VAULTCTL_BACKUP_GOOGLE_CLIENT_ID` | (none) | Google OAuth client id (enables the Google Drive destination). |
| `VAULTCTL_BACKUP_GOOGLE_CLIENT_SECRET` | (none) | Google OAuth client secret. |
| `VAULTCTL_BACKUP_DROPBOX_CLIENT_ID` | (none) | Dropbox OAuth app key (enables the Dropbox destination). |
| `VAULTCTL_BACKUP_DROPBOX_CLIENT_SECRET` | (none) | Dropbox OAuth app secret. |
| `VAULTCTL_BACKUP_ONEDRIVE_CLIENT_ID` | (none) | Azure app (client) id (enables the OneDrive destination). |
| `VAULTCTL_BACKUP_ONEDRIVE_CLIENT_SECRET` | (none) | Azure client secret. |

## Attachments

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_ATTACHMENTS_DIR` | `/data/attachments` | Directory for the encrypted attachment blob store. Back this up alongside Postgres. |
| `VAULTCTL_ATTACHMENT_MAX_BYTES` | `26214400` | Max size per attachment (25 MiB). |
| `VAULTCTL_ATTACHMENT_VAULT_QUOTA_BYTES` | `524288000` | Per-vault attachment quota (500 MiB). |

## Logging

| Variable | Default | Description |
| --- | --- | --- |
| `VAULTCTL_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |
| `VAULTCTL_LOG_FORMAT` | `json` | `json` or `text`. |
| `VAULTCTL_LOG_IP_PRECISION` | `coarse` | `coarse`, `full`, or `none`. Controls how much of the client IP is logged. |
| `VAULTCTL_LOG_REDACT_FIELDS` | `authHash,password,refresh_token,api_key,totp,masterKey,stretchedKey` | Field names scrubbed from structured logs. |
