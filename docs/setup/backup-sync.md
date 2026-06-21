# Backup and sync

Each user can attach one or more backup destinations and have vaultctl push
encrypted backups to them on a schedule. This is distinct from the admin
`vaultctl backup` DB dump; it is per-user and per-vault.

## How the encryption works

A destination never sees plaintext. The artifact is **double-sealed**:

1. The user's vault is exported as the same zero-knowledge ciphertext the
   client already produces (the server cannot read it).
2. That export is sealed again with the server data key
   (`VAULTCTL_DATA_ENCRYPTION_KEY`) before it leaves the box.

So backup sync requires `VAULTCTL_DATA_ENCRYPTION_KEY` to be set, and OAuth
provider credentials are sealed with the same key. A destination (S3 bucket,
Dropbox folder, etc.) only ever holds twice-encrypted bytes.

Master switch: `VAULTCTL_BACKUP_SYNC_ENABLED` (default `true`).

## Destinations

| Provider | Slug | Server config needed |
| --- | --- | --- |
| Local filesystem | `local` | None (writes to `VAULTCTL_BACKUP_LOCAL_DIR`, default `/data/backups`). |
| S3 (any S3-compatible) | `s3` | None. The user supplies bucket, region, endpoint, and credentials. |
| WebDAV | `webdav` | None. The user supplies URL and credentials. |
| Google Drive | `gdrive` | OAuth app (client id + secret). |
| Dropbox | `dropbox` | OAuth app (key + secret). |
| OneDrive | `onedrive` | Azure app (client id + secret). |

Local, S3, and WebDAV work out of the box. The three cloud providers appear in
the UI only once their OAuth credentials are set on the server.

## Cloud OAuth setup

For each cloud provider, register an OAuth app, set the **exact** redirect URI,
request the listed scopes, then set the env var pair and restart.

Redirect URI for every provider (substitute your slug):

```
<VAULTCTL_BASE_URL>/api/v1/backup/oauth/<slug>/callback
```

For example `https://vault.example.com/api/v1/backup/oauth/gdrive/callback`.

### Google Drive (`gdrive`)

- Console: <https://console.cloud.google.com/apis/credentials> (create an OAuth
  2.0 Client ID, type "Web application").
- Scope: `https://www.googleapis.com/auth/drive.appdata` (per-app hidden folder;
  no access to the user's other Drive files).
- Env: `VAULTCTL_BACKUP_GOOGLE_CLIENT_ID`, `VAULTCTL_BACKUP_GOOGLE_CLIENT_SECRET`.
- Caveat: the OAuth consent screen must be **Published**. While it is in
  "Testing" mode Google expires refresh tokens after 7 days, which silently
  breaks scheduled backups.

### Dropbox (`dropbox`)

- Console: <https://www.dropbox.com/developers/apps> (create an app with
  "App folder" access, not full Dropbox).
- Scopes: `files.content.write`, `files.content.read`.
- Env: `VAULTCTL_BACKUP_DROPBOX_CLIENT_ID`, `VAULTCTL_BACKUP_DROPBOX_CLIENT_SECRET`.
- Caveat: a development-mode Dropbox app is fine for personal use; production use
  for many users needs Dropbox to approve the app.

### OneDrive (`onedrive`)

- Console: <https://portal.azure.com> -> Azure Active Directory -> App
  registrations.
- Scopes: `Files.ReadWrite.AppFolder` and `offline_access` (the latter is
  required to get a durable refresh token).
- Supported account types: accounts in any org directory and personal Microsoft
  accounts.
- Env: `VAULTCTL_BACKUP_ONEDRIVE_CLIENT_ID`, `VAULTCTL_BACKUP_ONEDRIVE_CLIENT_SECRET`.
- Caveat: Azure client secrets expire (max lifetime 24 months). Rotate the
  secret before it lapses or scheduled backups stop.

## Connecting and scheduling

A user connects a cloud provider from **Settings** -> backup sync, which runs the
consent redirect and creates a destination. Local/S3/WebDAV destinations are
configured inline with the credentials the user provides.

- Frequency: `off`, `daily`, or `weekly`. `off` means manual-only (run from the
  UI). A freshly connected OAuth destination starts at `off`.
- Per-destination retention keeps the most recent N artifacts (default 7);
  older ones are pruned after a successful run.
- Server-wide, the admin DB-dump retention is `VAULTCTL_BACKUP_RETENTION_DAYS`
  (default 90), separate from per-destination retention above.

## Restore

Restore is per vault. From the destination's history, fetch an artifact (step-up
re-auth required, as with export), then re-import it into the target vault with
your master password. Because the artifact is the client-encrypted export, the
master password is what actually decrypts it; the server only unwraps the outer
data-key seal.
