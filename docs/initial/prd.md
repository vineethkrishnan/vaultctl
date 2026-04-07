# PRD: vaultctl

**Version:** 1.0
**Date:** March 18, 2026
**Author:** Vineeth N K
**Status:** Draft
**License:** AGPL-3.0

---

## 1. Problem Statement

Every password manager today is either:

- **Hosted SaaS** (1Password, Bitwarden Cloud) — your secrets live on someone else's servers.
- **Self-hosted but painful** (Vaultwarden) — works, but Rust codebase is hard to contribute to, and extending it means reverse-engineering Bitwarden's protocol.
- **CLI-only** (pass, gopass) — no web UI, not accessible to non-terminal users.

Developers and small teams want a password manager they fully control, that takes 30 seconds to deploy, has a modern UI, supports CLI/browser extension for daily use, and is built on a codebase they can actually read and extend.

---

## 2. Goals

- **Self-hosted first:** Single `docker compose up` to run. No external dependencies, no cloud accounts, no license keys.
- **Zero-knowledge:** Server never sees plaintext secrets. All encryption/decryption happens client-side (browser, CLI, extension).
- **Multi-user from day 1:** Teams can share vaults. Invite members, manage roles, share credentials.
- **Full access surface:** Web UI + CLI + browser extension — all in v1.
- **Developer-friendly:** Go backend, React frontend, clean hexagonal architecture. Easy to read, extend, contribute.
- **Import everything:** Migrate from Bitwarden, 1Password, LastPass, or KeePass in one step.
- **Production-ready security:** AES-256-GCM encryption, Argon2id key derivation, full threat model.
- **Cloud-ready foundation:** Architecture supports a future managed cloud offering (see Section 18.2) without forking. v1 is self-hosted only.

## 3. Non-Goals (v1)

- Mobile apps (iOS/Android)
- Managed cloud / hosted offering with subscription billing (planned post-v1, see Section 18.2)
- Multi-tenancy, per-tenant billing, usage metering
- SSO / SAML / LDAP integration
- Hardware key authentication for vault login (YubiKey, FIDO2 as login method — passkey *storage* is in scope, see Section 5.13)
- Secret sharing with expiring links
- Password breach monitoring (HaveIBeenPwned integration)
- Self-updating / auto-upgrade mechanism

---

## 4. Target Users & Personas

### Solo Developer

- Uses 1Password or Bitwarden but wants full control
- Comfortable with Docker and CLI
- Wants to fetch secrets in CI/CD scripts
- Single user, personal vault

### Small Team Lead (2–10 people)

- Needs shared credentials (staging DBs, API keys, deploy tokens)
- Wants to onboard/offboard team members without sharing master passwords
- Needs audit trail of who accessed what
- Runs on team's own VPS or homelab

### Self-Hosting Enthusiast

- Runs everything on their own hardware
- Doesn't trust SaaS with passwords
- Wants a clean Docker setup alongside their other services
- Values open-source transparency

---

## 5. Core Features (MVP)

### 5.1 Vault & Items

- Create, read, update, delete vault items
- Item types: Login (username + password + URL + TOTP), Secure Note, Credit Card, Identity, API Key, SSH Key, Passkey (see Section 5.13)
- Organize items in folders
- Star/favorite items
- Search across all items (client-side, on decrypted data)
- Auto-generated strong passwords (configurable length, character sets, passphrase mode)

### 5.2 Authentication

- Master password with Argon2id key derivation
- Optional TOTP-based 2FA for account login
- Session management with JWT (short-lived access + refresh tokens)
- Account lockout after N failed attempts (configurable)
- Password hint (stored server-side, never the actual password)

### 5.3 Multi-User & Sharing

- User registration (admin-controlled: open, invite-only, or disabled)
- User roles: Owner, Admin, Member
- Shared vaults (organization-level) with per-vault access control
- Personal vault per user (not shared)
- Invite users via email or invite link
- **Invite tokens (M11):** 256-bit random, single-use, 24–72h TTL, stored as `hmac_sha256(VAULTCTL_SERVER_PEPPER, token)` in DB, redemption rate-limited per-IP, auto-revoked on role change or inviter removal.
- **Member removal (C2):** removing ANY member (owner/admin/read-only) triggers unconditional `vaultKey` rotation + full re-encryption of the vault's items and folder names + re-wrapping for every remaining member. Read-only removal is NOT a special case.
- **First-admin bootstrap:** `vaultctl admin init` CLI command creates the first admin user in invite-only mode (no web path exists in that mode).

### 5.4 End-to-End Encryption

- All vault data encrypted client-side before transmission
- Server stores only ciphertext — zero knowledge
- AES-256-GCM for symmetric encryption
- Argon2id for master password → encryption key derivation
- RSA-2048 key pairs per user for vault sharing (encrypted private key stored server-side)
- See Section 7 for full encryption architecture

### 5.5 TOTP / 2FA Storage

- Store TOTP secrets alongside login items
- Generate current TOTP codes in the UI
- Copy code to clipboard with countdown timer
- **Server-side TOTP (account 2FA)**: secret stored encrypted under `VAULTCTL_DATA_ENCRYPTION_KEY` (H5)
- **Replay protection (H6)**: server tracks `users.totp_last_counter` (the T0/30s counter of the last accepted code) and rejects any submission with `counter <= last_counter`. Window drift tolerated: ±1 step.

### 5.6 Import / Export

- Import from: Bitwarden (JSON + CSV), 1Password (1PUX + CSV), LastPass (CSV), KeePass (XML)
- Export to: Encrypted JSON (vaultctl native), unencrypted CSV (with warning)
- Import runs client-side — file never sent to server unencrypted

### 5.7 CLI

- Authenticate with master password or API key
- CRUD operations on vault items
- Fetch individual secrets (for scripts/CI: `vaultctl get --name "GitHub Token" --field password`)
- Generate passwords
- Import/export
- Lock/unlock session
- See Section 12 for full command reference

### 5.8 Browser Extension

- Chrome + Firefox (Manifest V3)
- Auto-fill username + password on login forms
- Save new credentials on form submission
- Search and copy passwords (clipboard auto-cleared after timeout)
- Generate passwords inline
- TOTP auto-copy
- Passkey support: intercept WebAuthn registration/authentication to store and use passkeys from the vault
- Configurable auto-lock timeout (independent of web UI setting)
- Communicates with the self-hosted vaultctl server (configurable URL)

### 5.9 Web UI

- Dashboard: recently used, favorites, vault overview
- Full CRUD for all item types
- Folder management
- Password generator with live preview
- User management (admin panel)
- Organization/shared vault management
- Dark/light mode
- Responsive (works on tablet, not optimized for mobile)

### 5.10 Trash / Soft Delete

- Deleted items move to trash instead of permanent removal
- Trash retains items for 30 days (configurable via `VAULTCTL_TRASH_RETENTION_DAYS`)
- Users can restore items from trash or permanently purge them
- Automatic purge job runs daily to remove expired trash items
- Trash is per-vault (personal and shared vaults each have their own trash)
- Permanently purged items are irrecoverable

### 5.11 Clipboard & Session Security

- **Clipboard auto-clear:** After copying a password, TOTP code, or any secret field, the clipboard is cleared after a configurable timeout (default: 30 seconds). Applies to web UI, CLI, and browser extension.
- **Vault auto-lock:** Vault locks after a configurable inactivity period (default: 15 minutes). Requires master password re-entry to unlock. Configurable per client (web UI, extension, CLI).
- **Reprompt on sensitive items:** Items can be flagged as "require master password reprompt" — viewing the secret field requires re-entering the master password even within an active session.
- **Master password strength enforcement:** Registration and password change reject weak master passwords. Minimum 10 characters, checks against common password lists, provides strength meter feedback in UI.

### 5.12 Custom Fields & Password History

- **Custom fields:** Any item type can include user-defined custom fields (key-value pairs). Field types: text, hidden (masked like passwords), boolean, linked (URL). Custom fields are stored inside `encrypted_data` — server never sees them in plaintext.
- **Password history:** Login items retain an encrypted history of previous passwords (stored inside `encrypted_data`). History is capped at 20 entries per item. Users can view and copy historical passwords from the item detail view.

### 5.13 Additional Item Types

Beyond Login, Secure Note, Credit Card, and Identity:

- **API Key:** Name, key value, environment (prod/staging/dev), expiration date, associated service/URL, notes
- **SSH Key:** Name, public key, private key (encrypted), passphrase (encrypted), fingerprint, associated host
- **Passkey:** Relying party ID, relying party name, credential ID, user handle, public key, discoverable flag, creation date, last used date. Browser extension supports WebAuthn registration relay — intercepts `navigator.credentials.create()` to store passkeys in the vault and `navigator.credentials.get()` to authenticate with stored passkeys.

### 5.14 Recovery Kit (M12)

Zero-knowledge means losing the master password = losing the vault. To prevent day-one catastrophic loss, registration generates a printable **Recovery Kit**:

- Generated client-side at registration, shown **exactly once**, never stored server-side.
- Contents: a 256-bit recovery key + the user's RSA-encrypted private key wrapped with that recovery key. Printable as both QR code and grouped-5-char text (Shamir-style grouping for readability).
- User is prompted to print/save and is required to confirm "I have stored my kit" before registration completes.
- Recovery flow: user uploads the kit → client unwraps their RSA private key → client derives a **new** master key from a new master password → server replaces `auth_hash`, `salt`, `kdf_*`, `encrypted_private_key`, `encrypted_identity_private_key` atomically.
- Recovery kit can be regenerated after login (invalidates the old one).
- Modeled on Bitwarden's Emergency Sheet. Documented in UI as "the only backdoor — treat it like cash".

---

## 6. Architecture

### 6.1 System Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Browser Ext  │────→│              │     │                  │
└──────────────┘     │              │     │   PostgreSQL      │
                     │   vaultctl   │────→│   (encrypted      │
┌──────────────┐     │   (Go API)   │     │    vault data)    │
│  Web UI       │────→│              │     │                  │
│  (React SPA)  │     │              │     └──────────────────┘
└──────────────┘     │              │
                     │              │
┌──────────────┐     │              │
│  CLI          │────→│              │
└──────────────┘     └──────────────┘
```

All three clients (web UI, CLI, browser extension) talk to the same Go API server. Encryption/decryption happens in the client. The server only stores and serves ciphertext.

### 6.2 Hexagonal Layout

```
vaultctl/
├── cmd/                                    # Entry points
│   ├── server/
│   │   └── main.go                         # API server entry
│   └── cli/
│       └── main.go                         # CLI entry
│
├── internal/                               # Private application code
│   ├── domain/                             # Pure Go — ZERO framework imports
│   │   ├── vault/
│   │   │   ├── item.go                     # VaultItem entity
│   │   │   ├── item_type.go                # Login, SecureNote, CreditCard, Identity, APIKey, SSHKey, Passkey
│   │   │   ├── folder.go                   # Folder entity
│   │   │   ├── vault.go                    # Vault aggregate (personal, shared)
│   │   │   ├── custom_field.go              # CustomField value object (text, hidden, boolean, linked)
│   │   │   ├── password_history.go          # PasswordHistory value object
│   │   │   └── errors.go                   # Domain errors
│   │   ├── user/
│   │   │   ├── user.go                     # User entity
│   │   │   ├── role.go                     # Owner, Admin, Member
│   │   │   ├── session.go                  # Session value object
│   │   │   └── errors.go
│   │   ├── organization/
│   │   │   ├── organization.go             # Org entity (team)
│   │   │   ├── membership.go               # User-Org relationship
│   │   │   └── errors.go
│   │   ├── crypto/
│   │   │   ├── symmetric_key.go            # AES-256-GCM key value object
│   │   │   ├── key_pair.go                 # RSA key pair value object
│   │   │   ├── encrypted_blob.go           # Ciphertext + nonce + metadata
│   │   │   └── password_hash.go            # Argon2id hash value object
│   │   └── import_export/
│   │       ├── import_format.go            # Bitwarden, 1Password, LastPass, KeePass
│   │       └── export_format.go
│   │
│   ├── application/                        # Use cases — imports domain/ only
│   │   ├── ports/                          # Outbound interfaces
│   │   │   ├── vault_repository.go
│   │   │   ├── user_repository.go
│   │   │   ├── org_repository.go
│   │   │   ├── session_store.go
│   │   │   ├── api_key_repository.go
│   │   │   ├── email_sender.go
│   │   │   └── token_service.go
│   │   ├── vault/
│   │   │   ├── create_item.go              # CreateItemUseCase
│   │   │   ├── get_item.go
│   │   │   ├── update_item.go
│   │   │   ├── delete_item.go
│   │   │   ├── list_items.go
│   │   │   ├── search_items.go
│   │   │   ├── manage_folders.go
│   │   │   ├── share_vault.go
│   │   │   ├── trash_item.go               # SoftDeleteItemUseCase, RestoreItemUseCase, PurgeTrashUseCase
│   │   │   └── password_history.go         # GetPasswordHistoryUseCase
│   │   ├── auth/
│   │   │   ├── login.go                    # LoginUseCase
│   │   │   ├── register.go
│   │   │   ├── refresh_token.go
│   │   │   ├── setup_totp.go
│   │   │   ├── verify_totp.go
│   │   │   ├── change_password.go
│   │   │   └── manage_api_keys.go          # CreateAPIKeyUseCase, RevokeAPIKeyUseCase, ListAPIKeysUseCase
│   │   ├── user/
│   │   │   ├── invite_user.go
│   │   │   ├── update_profile.go
│   │   │   └── manage_roles.go
│   │   ├── import_export/
│   │   │   ├── import_vault.go
│   │   │   └── export_vault.go
│   │   └── backup/
│   │       └── create_backup.go            # CreateBackupUseCase
│   │
│   ├── infrastructure/                     # All external-facing code
│   │   ├── postgres/                       # PostgreSQL repositories
│   │   │   ├── vault_repository.go
│   │   │   ├── user_repository.go
│   │   │   ├── org_repository.go
│   │   │   ├── migrations/                 # SQL migration files
│   │   │   └── models/                     # DB record structs (not domain entities)
│   │   ├── auth/
│   │   │   ├── jwt_token_service.go
│   │   │   ├── argon2_hasher.go
│   │   │   └── session_store.go
│   │   ├── email/
│   │   │   └── smtp_sender.go
│   │   └── config/
│   │       └── config.go                   # Env-based configuration
│   │
│   └── presenters/                         # Inbound adapters (API + CLI)
│       ├── api/                            # HTTP REST API
│       │   ├── router.go                   # Route definitions
│       │   ├── middleware/
│       │   │   ├── auth.go                 # JWT validation
│       │   │   ├── rate_limit.go
│       │   │   └── cors.go
│       │   ├── handlers/
│       │   │   ├── vault_handler.go
│       │   │   ├── auth_handler.go
│       │   │   ├── user_handler.go
│       │   │   ├── org_handler.go
│       │   │   ├── import_export_handler.go
│       │   │   ├── api_key_handler.go
│       │   │   ├── backup_handler.go
│       │   │   └── health_handler.go
│       │   └── dto/                        # Request/response DTOs
│       │       ├── vault_dto.go
│       │       ├── auth_dto.go
│       │       └── user_dto.go
│       └── cli/                            # CLI commands
│           ├── root.go
│           ├── get.go
│           ├── create.go
│           ├── list.go
│           ├── generate.go
│           ├── import.go
│           ├── export.go
│           ├── api_key.go
│           ├── trash.go
│           ├── history.go
│           ├── backup.go
│           ├── lock.go
│           ├── login.go
│           └── config.go
│
├── web/                                    # React frontend (separate build)
│   ├── src/
│   │   ├── app/                            # App shell, routing, providers
│   │   ├── pages/                          # Route pages (vault, settings, admin)
│   │   ├── features/                       # Feature slices (item-editor, password-generator, import)
│   │   ├── entities/                       # Shared data models (vault-item, user, org)
│   │   ├── shared/                         # UI components, crypto utils, API client
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── extension/                              # Browser extension (Manifest V3)
│   ├── src/
│   │   ├── background/                     # Service worker
│   │   ├── popup/                          # Extension popup UI (React)
│   │   ├── content/                        # Content scripts (auto-fill)
│   │   └── shared/                         # Crypto, API client (shared with web/)
│   └── manifest.json
│
├── migrations/                             # Database migrations
├── scripts/                                # Build, deploy, dev scripts
├── docs/                                   # Documentation (VitePress)
├── Dockerfile
├── docker-compose.yml
├── docker-compose.simple.yml              # Without Caddy (BYO reverse proxy)
├── Caddyfile
├── .env.example
├── Makefile
├── go.mod
└── go.sum
```

### 6.3 Dependency Flow

```
presenters/ ──→ application/ ──→ domain/
                     ↑
infrastructure/ ─────┘ (implements application/ports/)
```

- `domain/` imports **nothing** outside itself. Pure Go. No frameworks, no database, no HTTP.
- `application/` imports only `domain/`. Defines outbound ports as interfaces. Contains use cases.
- `infrastructure/` implements `application/ports/` with real adapters (PostgreSQL, JWT, SMTP).
- `presenters/` maps HTTP/CLI input to use case calls. Imports `application/` use cases.

### 6.4 Layer Rules

| Layer | Responsibility | Imports |
|-------|---------------|---------|
| **domain/** | Entities, value objects, domain errors. Pure Go. | Nothing external |
| **application/** | Use cases, port interfaces. Orchestration logic. | domain/ only |
| **infrastructure/** | PostgreSQL repos, JWT, Argon2, SMTP, config. | application/ports/ + domain/ + external libs |
| **presenters/api/** | HTTP handlers, middleware, DTOs, routing. | application/ use cases |
| **presenters/cli/** | CLI commands, arg parsing, output formatting. | application/ use cases |

---

## 7. Security Architecture

### 7.1 Encryption Scheme

```
Master Password
      │
      ▼
┌─────────────────────────────────┐
│  Argon2id(password, salt)       │  ← KDF: 3 iterations, 64MB memory, 4 parallelism
│  → 256-bit Master Key           │
└─────────────────────────────────┘
      │
      ├──→ Stretched Key = HKDF-SHA256(masterKey, "enc")
      │         └──→ AES-256-GCM encrypt/decrypt vault data
      │
      ├──→ Auth Hash = HKDF-SHA256(masterKey, "auth")
      │         └──→ Sent to server for authentication (never the master password)
      │
      └──→ RSA-2048 Key Pair (generated on registration)
                ├──→ Public key: stored server-side (plaintext)
                └──→ Private key: encrypted with Stretched Key, stored server-side
```

### 7.2 Vault Sharing (Organizations)

When sharing a vault with another user:

1. Sender encrypts the vault's symmetric key with the recipient's RSA public key.
2. Encrypted key is stored on the server, associated with the recipient.
3. Recipient decrypts the vault key with their RSA private key (which they decrypt with their own master key).
4. Recipient can now decrypt vault items using the shared vault key.

### 7.3 Zero-Knowledge Guarantees

- Server **never** receives the master password.
- Server **never** receives the master key or stretched key.
- Server only receives the **auth hash** (derived from master key via HKDF) for authentication.
- All vault data is encrypted **before** leaving the client.
- Server stores only: ciphertext, encrypted private keys, public keys, auth hashes, salts.

### 7.4 Threat Model

| Threat | Mitigation |
|--------|-----------|
| **Server database compromise** | All vault data is AES-256-GCM encrypted. Attacker gets ciphertext only. Master key never stored server-side. Refresh tokens stored as HMAC (C3), API key hashes as HMAC (H7), TOTP secrets + password hints encrypted under a server key held outside the DB backup (H5, M2). |
| **Server impersonation / sharing MITM (C1)** | Public keys served by the server are signed by each user's Ed25519 identity key. Clients verify the signature before wrapping any vault key, and pin identity keys TOFU-style. A safety-number fingerprint is exposed in the UI for out-of-band verification. |
| **Auth credential on the wire (C4)** | `authHash` is treated as a secret: logging middleware strips it (and every field in `VAULTCTL_LOG_REDACT_FIELDS`) before any log line is emitted. Trusted proxies (Caddy/nginx) have body-logging disabled on `/api/v1/auth/*`. A CI security test asserts `authHash` never appears in log output. |
| **User enumeration via prelogin (H2)** | For unknown emails, server returns a deterministic pseudo-salt `HMAC(VAULTCTL_ENUMERATION_PEPPER, lower(email))` + current default KDF params. Response shape and timing match the real-user case. |
| **Credential stuffing (H3)** | Per-email bucket (5 attempts / 15min) in addition to per-IP limit; global circuit breaker alerts if failed-auth rate > 1000/min. Failed-login counters persisted in `users.failed_login_attempts` so state survives restarts. |
| **Stolen access token used for sensitive ops (H10)** | Step-up auth: password change, API key creation, full export, backup trigger, and trash purge all require a fresh master-password reprompt proof (< `VAULTCTL_STEP_UP_MAX_AGE`) OR a TOTP challenge in the same request. |
| **Cross-vault IDOR (H11)** | Every item handler verifies BOTH `user ∈ vault_members(vaultId)` AND `item.vault_id == :vaultId`. A cross-vault IDOR test is part of the security suite. |
| **Brute force (online)** | Rate limiting (5 attempts/minute), account lockout after N failures (configurable, default 5), exponential backoff. |
| **Brute force (offline, stolen DB)** | Argon2id with 64MB memory cost makes offline cracking extremely expensive (~$100K+ to crack a single strong password). |
| **Man-in-the-middle** | TLS required in production. API rejects non-HTTPS in production mode. Browser extension validates server certificate. |
| **Session hijacking** | Short-lived JWT access tokens (15 min), refresh tokens bound to device fingerprint, revocable sessions. |
| **Memory scraping** | Go's garbage collector zeroes memory. Sensitive values (keys, passwords) use `memguard` or equivalent for secure memory allocation. |
| **XSS (web UI)** | React's default escaping. CSP headers. No `dangerouslySetInnerHTML`. Secrets never in URL params. |
| **CSRF (M7)** | v1 uses **header-only auth** (`Authorization: Bearer <JWT>`). JWTs are NEVER placed in cookies. This eliminates CSRF by construction at the cost of XSS exposure — therefore strict CSP (see architecture.md §6.2) is load-bearing. Refresh tokens travel only in `Authorization: Bearer` over HTTPS; the web client holds them in a Web Worker scope (see M9). |
| **Clipboard leakage** | Auto-clear clipboard after configurable timeout (default 30s). Never write secrets to system clipboard history. |
| **Unattended session** | Auto-lock after configurable inactivity period (default 15 min). Reprompt flag for high-value items. |
| **Weak master password** | Minimum length enforcement (10 chars), common password list check, strength meter in UI. |
| **Accidental deletion** | Soft delete with 30-day trash retention. Permanent purge requires explicit confirmation. |
| **Data loss (self-hosted)** | Built-in backup command, documented restore procedure, backup strategy guidance per deployment tier. |

---

## 8. Tech Stack

### 8.1 Backend (Go)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Language | Go 1.23+ | Single static binary, strong stdlib crypto |
| HTTP router | `chi` | stdlib-compatible, no magic |
| Database | PostgreSQL 16 | Only DB supported |
| Database driver | `jackc/pgx/v5` | Native Postgres driver with pool |
| SQL layer | `sqlc` | Generates type-safe Go from `.sql` files — no ORM |
| Migrations | `golang-migrate/migrate` | `up`/`down` SQL migrations |
| JWT | `golang-jwt/jwt/v5` | Access + refresh token signing |
| Argon2id | `golang.org/x/crypto/argon2` | Stdlib extension |
| TOTP | `pquerna/otp` | TOTP secret generation + verification |
| Symmetric crypto | `crypto/aes`, `crypto/cipher` (stdlib) | AES-256-GCM |
| Asymmetric crypto | `crypto/rsa`, `crypto/rand` (stdlib) | RSA-2048 + OAEP |
| KDF | `golang.org/x/crypto/hkdf` | HKDF-SHA256 for key derivation |
| Secure memory | `awnumar/memguard` | Zero-on-free for master keys, stretched keys, vault keys |
| Validation | `go-playground/validator/v10` | Struct-tag input validation |
| Config | `caarlos0/env/v10` | Struct-tag env var parsing (no YAML/TOML) |
| Logging | `log/slog` (stdlib) | Structured JSON logs |
| Rate limiting | `ulule/limiter/v3` | In-memory v1, Redis-backed for cloud |
| Email (SMTP) | `wneessen/go-mail` | Modern SMTP client |
| Testing | `testing` (stdlib) + `stretchr/testify` | Assertions, mocks |
| Integration testing | `testcontainers/testcontainers-go` | Real Postgres in CI |

### 8.2 Frontend (Web UI)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Framework | React 19 | |
| Build tool | Vite 6 | |
| Router | TanStack Router | Type-safe routes, file-based |
| Data fetching | TanStack Query v5 | Server state, caching, invalidation |
| State management | Zustand | Auth state + decrypted vault key state |
| Forms | `react-hook-form` | Handles conditional item-type fields |
| Validation | `zod` | Shared schemas with API |
| UI components | shadcn/ui + Tailwind CSS | Copy-paste components |
| Icons | `lucide-react` | Ships with shadcn/ui |
| API client | `openapi-fetch` + generated types | Type-safe from OpenAPI spec |
| Argon2id (browser) | `hash-wasm` | WASM Argon2id, fastest in-browser |
| Symmetric/asym crypto | Web Crypto API (native) | AES-GCM, RSA-OAEP, HKDF |
| Testing | Vitest + React Testing Library | Component + unit tests |
| E2E testing | Playwright | Critical flow coverage |

### 8.3 Browser Extension

| Component | Technology | Notes |
|-----------|-----------|-------|
| Framework | WXT | Vite-based, Manifest V3-first, hot reload |
| UI | React (shared with web/) | Shared components, shared crypto |
| WebAuthn relay | Native `navigator.credentials` | For passkey storage |
| Build targets | Chrome + Firefox | Single codebase, dual manifests |

### 8.4 CLI

| Component | Technology | Notes |
|-----------|-----------|-------|
| Framework | `spf13/cobra` | Command tree + flag parsing |
| Config | `caarlos0/env/v10` | Same as backend |
| Interactive prompts | `charmbracelet/huh` | Master password entry, confirmations |
| Table output | `olekukonko/tablewriter` | `vaultctl list` formatting |
| OS keychain | `zalando/go-keyring` | Session token stored in OS keychain |

### 8.5 Infrastructure & Deployment

| Component | Technology | Notes |
|-----------|-----------|-------|
| Container | Docker + Docker Compose | Multi-stage build |
| Reverse proxy | Caddy 2 | Automatic Let's Encrypt TLS |
| Database backup | `pg_dump` (shell-out) | Called from Go via `os/exec` |
| CI/CD | GitHub Actions | Lint, test, build, release |
| Release | `goreleaser` + `release-please` | Binaries + versioning |
| Container registry | GHCR + Docker Hub | Multi-arch (amd64, arm64) |
| Docs site | VitePress | Deployed to GH Pages / Cloudflare Pages |

### 8.6 Development Tooling

| Component | Technology |
|-----------|-----------|
| Go linter | `golangci-lint` (depguard, gosec, govet, staticcheck, errcheck, gocyclo) |
| Frontend linter | `eslint` + `@typescript-eslint` |
| Formatter (frontend) | `prettier` |
| Dockerfile linter | `hadolint` |
| Pre-commit hooks | `lefthook` |
| Commit linting | `commitlint` |
| Dependency updates | Renovate (or Dependabot) |
| OpenAPI generation | `swaggo/swag` (from handler annotations) |
| Vulnerability scanning | `govulncheck` + `npm audit` |

---

## 9. Database Schema

### 9.1 Users

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    auth_hash       VARCHAR(512) NOT NULL,     -- HKDF(masterKey, "auth"), hashed again with Argon2 server-side
    salt            BYTEA NOT NULL,            -- Argon2 salt (sent to client during login)
    kdf_iterations  INT NOT NULL DEFAULT 3,
    kdf_memory      INT NOT NULL DEFAULT 65536, -- 64MB
    kdf_parallelism INT NOT NULL DEFAULT 4,
    encrypted_private_key  TEXT NOT NULL,       -- RSA private key encrypted with user's stretched key (versioned blob — see §9.9)
    public_key      TEXT NOT NULL,              -- RSA public key (plaintext bytes)
    public_key_signature TEXT NOT NULL,         -- [C1] Ed25519 signature of public_key by user's identity_public_key
    identity_public_key  TEXT NOT NULL,         -- [C1] Ed25519 identity pubkey — clients pin TOFU, expose as safety number
    encrypted_identity_private_key TEXT NOT NULL, -- [C1] Ed25519 identity privkey, AES-GCM sealed with stretchedKey
    encrypted_password_hint BYTEA,              -- [H4] server-encrypted with VAULTCTL_DATA_ENCRYPTION_KEY; was plaintext
    totp_secret     BYTEA,                      -- [H5] AES-256-GCM with VAULTCTL_DATA_ENCRYPTION_KEY (NULL if 2FA off)
    totp_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    totp_last_counter BIGINT,                   -- [H6] last accepted TOTP 30s counter; reject codes with counter <= this
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    role            VARCHAR(50) NOT NULL DEFAULT 'member',  -- global role: owner, admin, member
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 9.2 Vaults

```sql
CREATE TABLE vaults (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50) NOT NULL,       -- 'personal' or 'shared'
    org_id          UUID REFERENCES organizations(id),  -- NULL for personal vaults
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vault_members (
    vault_id        UUID REFERENCES vaults(id) ON DELETE RESTRICT,     -- [M3] was ON DELETE CASCADE; block to preserve audit trail
    user_id         UUID REFERENCES users(id) ON DELETE RESTRICT,      -- [M3] deletions must go through soft-delete path
    encrypted_vault_key TEXT NOT NULL,          -- [H1] versioned blob: {wrapped_key, sender_id, sender_signature} — see §9.9
    wrap_sender_id  UUID REFERENCES users(id),  -- [H1] who wrapped this key for this recipient (for signature verification)
    wrap_signature  TEXT NOT NULL,              -- [H1] Ed25519 signature over (vault_id, user_id, encrypted_vault_key) by sender's identity key
    role            VARCHAR(50) NOT NULL DEFAULT 'member',  -- owner, admin, member
    removed_at      TIMESTAMPTZ,                -- [M3] soft-delete marker; membership history preserved for compliance
    PRIMARY KEY (vault_id, user_id)
);
```

### 9.3 Vault Items

```sql
CREATE TABLE vault_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id        UUID REFERENCES vaults(id) ON DELETE CASCADE NOT NULL,
    folder_id       UUID REFERENCES folders(id) ON DELETE SET NULL,
    item_type       VARCHAR(50) NOT NULL,       -- login, secure_note, credit_card, identity, api_key, ssh_key, passkey
    encrypted_data  TEXT NOT NULL,               -- [C5] versioned blob: v1|alg_id|nonce|ct|tag — see §9.9; payload padded to 32B boundary [M5]
    encrypted_name  TEXT NOT NULL,               -- [C5][M5] versioned blob; name padded to next 32B boundary before encryption to defeat length fingerprinting
    favorite        BOOLEAN NOT NULL DEFAULT FALSE,
    reprompt        BOOLEAN NOT NULL DEFAULT FALSE,  -- Require master password re-entry to reveal secrets
    deleted_at      TIMESTAMPTZ,                -- NULL = active, non-NULL = in trash (soft delete)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vault_items_vault_id ON vault_items(vault_id);
CREATE INDEX idx_vault_items_folder_id ON vault_items(folder_id);
CREATE INDEX idx_vault_items_deleted_at ON vault_items(deleted_at) WHERE deleted_at IS NOT NULL;
```

### 9.4 Folders

```sql
CREATE TABLE folders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id        UUID REFERENCES vaults(id) ON DELETE CASCADE NOT NULL,
    encrypted_name  TEXT NOT NULL,               -- [C5][M5] versioned blob; folder name padded to next 32B boundary before encryption
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 9.5 Organizations

```sql
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    created_by      UUID REFERENCES users(id) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE org_members (
    org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL DEFAULT 'member',
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at     TIMESTAMPTZ,
    PRIMARY KEY (org_id, user_id)
);
```

### 9.6 Sessions

```sql
CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    refresh_token_hash  BYTEA UNIQUE NOT NULL,   -- [C3] hmac_sha256(VAULTCTL_SERVER_PEPPER, refresh_token); raw token is NEVER stored
    device_name         VARCHAR(255),
    ip_address          INET,                    -- [M1] truncated to /24 (v4) or /56 (v6) when VAULTCTL_LOG_IP_PRECISION=coarse
    last_refresh_at     TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);
```

### 9.7 API Keys

```sql
CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    key_hash        BYTEA NOT NULL,            -- [H7] hmac_sha256(VAULTCTL_SERVER_PEPPER, api_key); was raw SHA-256
    key_prefix      VARCHAR(10) NOT NULL,      -- First 8 chars of the key for identification (e.g., "vk_abc12...")
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,               -- NULL = never expires
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
```

### 9.8 Audit Log

```sql
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,      -- login, item_create, item_read, item_update, item_delete, item_restore, item_purge, vault_share, vault_create, backup_create, member_added, member_removed, role_changed, etc.
    resource_type   VARCHAR(50),               -- user, vault_item, vault, organization
    resource_id     UUID,
    ip_address      INET,                      -- [M1] truncated to /24 (v4) or /56 (v6) when VAULTCTL_LOG_IP_PRECISION=coarse (default); full only if =full
    user_agent      TEXT,                      -- [M1] retained 30 days only (raw); action log kept 365 days with ip_address NULL'd after 30d
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

### 9.9 Ciphertext Blob Format (C5)

Every encrypted blob stored in the database carries a version + algorithm header so that algorithm migration (RSA→X25519/HPKE, AES-GCM→XChaCha20-Poly1305, Argon2id param bumps) can happen without a full-vault rewrite.

**Wire format (base64-encoded TEXT column):**

```
┌─────────┬─────────┬────────────────┬────────────────┬────────────┐
│ version │ alg_id  │     nonce      │   ciphertext   │    tag     │
│  1 byte │ 1 byte  │   variable     │    variable    │  variable  │
└─────────┴─────────┴────────────────┴────────────────┴────────────┘
```

- **version** (1 byte): blob format version. `0x01` for v1.
- **alg_id** (1 byte): algorithm identifier. Must be enumerated in committed constants.
- **nonce + ciphertext + tag**: AEAD output; sizes determined by `alg_id`.

**Allowed `alg_id` values (v1):**

| `alg_id` | Algorithm | Nonce | Tag | Used For |
|----------|-----------|-------|-----|----------|
| `0x01` | AES-256-GCM | 96 bits | 128 bits | `vault_items.encrypted_data/name`, `folders.encrypted_name`, `users.encrypted_private_key`, `users.encrypted_identity_private_key`, `users.totp_secret`, `users.encrypted_password_hint` |
| `0x02` | RSA-OAEP-SHA256-2048 | n/a | n/a | `vault_members.encrypted_vault_key` (shared vaults) |
| `0x03` | AES-256-KW (NIST SP 800-38F) | n/a | 64 bits | `vault_members.encrypted_vault_key` (personal vaults, M4) |

**Migration contract:**
- Clients MUST accept every `alg_id` listed above on read.
- New writes MUST use the latest supported `alg_id` for that field.
- Adding a new `alg_id` is a non-breaking change. Removing one requires a feature-flagged re-encryption pass and a major-version migration.

**Plaintext padding (M5):** before encryption, `encrypted_name` and `folders.encrypted_name` plaintext is padded to the next 32-byte boundary using PKCS#7-style padding to defeat length fingerprinting over DB dumps.

**Nonce policy (H9):** 96-bit nonces MUST be drawn from `crypto/rand` (NO counter-mode nonces). A vault-key rotation trigger fires once item count under a single key exceeds 2^28 (~268M encryptions) — well below the birthday bound — or annually, whichever comes first. Security test: two back-to-back encryptions of identical plaintext MUST produce different ciphertext.

---

## 10. API Specification

### 10.1 Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login (returns access + refresh tokens, encPrivKey, encIdentityPrivKey, publicKeySignature) |
| POST | `/api/v1/auth/refresh` | Refresh access token (rotates refresh token; server stores only `refresh_token_hash`) |
| POST | `/api/v1/auth/logout` | Revoke session |
| GET | `/api/v1/auth/prelogin` | Get KDF params + salt. For unknown emails, returns deterministic fake-salt `HMAC(enumeration_pepper, lower(email))` + default KDF params with identical timing (H2). |
| POST | `/api/v1/auth/totp/setup` | Enable 2FA (returns QR code) |
| POST | `/api/v1/auth/totp/verify` | Verify 2FA code during login (rejects if `counter <= users.totp_last_counter`, H6) |
| POST | `/api/v1/auth/password/change` | Change master password (re-encrypts vault keys) — **requires step-up proof** (H10) |
| POST | `/api/v1/auth/step-up` | Submit fresh `authHash` to obtain a short-lived step-up claim (used for sensitive endpoints, H10) |
| GET | `/api/v1/auth/password/hint` | Get password hint (decrypts server-side via `VAULTCTL_DATA_ENCRYPTION_KEY`) |
| POST | `/api/v1/auth/recovery/verify` | Verify uploaded Recovery Kit, issue recovery session (M12) |
| POST | `/api/v1/auth/recovery/reset` | Complete master password reset via recovery session (M12) |

**Step-up requirement (H10):** the following endpoints require a step-up claim ≤ `VAULTCTL_STEP_UP_MAX_AGE` old embedded in the JWT header or passed as `X-Step-Up-Claim`:
- `POST /auth/password/change`
- `POST /users/me/api-keys`
- `GET /export`
- `POST /admin/backup`
- `DELETE /vaults/:id/trash/:id`
- `DELETE /vaults/:id/trash`
- `DELETE /users/me/api-keys/:id`

### 10.2 Vault Items

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/vaults/:vaultId/items` | List active items in vault (excludes trash) |
| GET | `/api/v1/vaults/:vaultId/items/:id` | Get single item |
| POST | `/api/v1/vaults/:vaultId/items` | Create item (supports all types: login, secure_note, credit_card, identity, api_key, ssh_key, passkey) |
| PUT | `/api/v1/vaults/:vaultId/items/:id` | Update item |
| DELETE | `/api/v1/vaults/:vaultId/items/:id` | Soft delete item (move to trash) |

### 10.2.1 Trash

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/vaults/:vaultId/trash` | List items in trash |
| POST | `/api/v1/vaults/:vaultId/trash/:id/restore` | Restore item from trash |
| DELETE | `/api/v1/vaults/:vaultId/trash/:id` | Permanently purge item |
| DELETE | `/api/v1/vaults/:vaultId/trash` | Purge all expired trash items |

### 10.3 Vaults & Folders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/vaults` | List user's vaults (personal + shared) |
| POST | `/api/v1/vaults` | Create shared vault |
| GET | `/api/v1/vaults/:id/folders` | List folders |
| POST | `/api/v1/vaults/:id/folders` | Create folder |
| PUT | `/api/v1/vaults/:id/folders/:folderId` | Rename folder |
| DELETE | `/api/v1/vaults/:id/folders/:folderId` | Delete folder |

### 10.4 Organizations & Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/orgs` | Create organization |
| GET | `/api/v1/orgs/:id/members` | List members |
| POST | `/api/v1/orgs/:id/invite` | Invite user (token: 256-bit random, single-use, TTL ≤ 72h, HMAC'd at rest — M11) |
| POST | `/api/v1/orgs/:id/invite/accept` | Redeem invite token (rate-limited per IP) |
| PUT | `/api/v1/orgs/:id/members/:userId` | Update member role — triggers vault rekey if downgrading to read-only or lower (C2) |
| DELETE | `/api/v1/orgs/:id/members/:userId` | Remove member — triggers **unconditional** vault rekey (C2); logs `member_removed` audit row |
| GET | `/api/v1/orgs/:id/members/:userId/pubkey` | Fetch member's `{publicKey, publicKeySignature, identityPublicKey}` for wrapping (C1); client verifies signature before use |
| GET | `/api/v1/users/me` | Get current user profile |
| PUT | `/api/v1/users/me` | Update profile |
| GET | `/api/v1/users/me/sessions` | List active sessions |
| DELETE | `/api/v1/users/me/sessions/:id` | Revoke session |

### 10.5 API Keys (for CLI / CI Authentication)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/users/me/api-keys` | List user's API keys (name, prefix, created, last used — never the full key) |
| POST | `/api/v1/users/me/api-keys` | Create API key (returns full key once, then only prefix is stored) |
| DELETE | `/api/v1/users/me/api-keys/:id` | Revoke API key |

### 10.6 Import / Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/import` | Import items (encrypted payload from client) |
| GET | `/api/v1/export` | Export all items (encrypted, client decrypts) |

### 10.7 Backup (Admin Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/admin/backup` | Trigger database backup (returns backup metadata) |
| GET | `/api/v1/admin/backups` | List available backups |

Note: Backup is also available via CLI (`vaultctl backup`) which calls these endpoints. Restore is intentionally CLI-only to prevent accidental overwrites via the API.

### 10.8 System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/config` | Public server config (registration mode, 2FA required, etc.) |

---

## 11. Configuration

### 11.1 `.env` Template

```env
# Server
VAULTCTL_PORT=8080
VAULTCTL_HOST=0.0.0.0
VAULTCTL_BASE_URL=https://vault.example.com
VAULTCTL_ENV=production                     # production | development

# Database
VAULTCTL_DB_HOST=vaultctl-db
VAULTCTL_DB_PORT=5432
VAULTCTL_DB_NAME=vaultctl
VAULTCTL_DB_USER=vaultctl
VAULTCTL_DB_PASSWORD=change-me
VAULTCTL_DB_SSL_MODE=require                # [H12] default: require | verify-full | disable. Docker Compose override is the ONLY place where `disable` is acceptable (loopback inside compose net)

# JWT signing keys — dual-key rotation (H8)
# Generate with: openssl rand -base64 64
VAULTCTL_JWT_SECRET_CURRENT=change-me-to-random-64-chars   # signs NEW tokens
VAULTCTL_JWT_SECRET_NEXT=                                   # during rotation: new key (verify-only) then swap into _CURRENT
VAULTCTL_JWT_KID_CURRENT=k1                                 # kid header on issued tokens; bump on each rotation
VAULTCTL_JWT_ACCESS_TTL=15m
VAULTCTL_JWT_REFRESH_TTL=7d
# Rotation procedure: see docs/security/jwt-rotation.md — grace window allows zero-downtime key swap.

# Server-side data encryption key (H5) — encrypts totp_secret, password_hint
# Generate with: openssl rand -base64 32
# MUST be stored in a DIFFERENT location from DB backups (see §17.4 and M2).
VAULTCTL_DATA_ENCRYPTION_KEY=change-me-32-bytes-base64
VAULTCTL_DATA_ENCRYPTION_KEY_NEXT=                          # dual-key rotation window; decrypt-with-either, re-encrypt-with-new

# Server peppers (C3, H7, H2) — never rotated without a planned migration
# Generate with: openssl rand -base64 32
VAULTCTL_SERVER_PEPPER=change-me-32-bytes-base64            # HMAC pepper for sessions.refresh_token_hash + api_keys.key_hash
VAULTCTL_ENUMERATION_PEPPER=change-me-32-bytes-base64       # HMAC pepper for prelogin fake-salt generation

# Security
VAULTCTL_REGISTRATION_MODE=invite           # open | invite | disabled
VAULTCTL_REQUIRE_2FA=false
VAULTCTL_MAX_LOGIN_ATTEMPTS=5
VAULTCTL_LOCKOUT_DURATION=15m
VAULTCTL_RATE_LIMIT_RPM=60                  # [H3] requests per minute per IP (coarse)
VAULTCTL_AUTH_RATE_LIMIT_PER_EMAIL=5        # [H3] per-email bucket on /auth/login and /auth/prelogin (per 15 min)
VAULTCTL_AUTH_RATE_LIMIT_WINDOW=15m         # [H3] window for per-email auth bucket
VAULTCTL_AUTH_GLOBAL_ALERT_THRESHOLD=1000   # [H3] global circuit breaker: if total failed auths/min exceed this, alert + tighten limits
VAULTCTL_TRUSTED_PROXIES=127.0.0.1/32       # [H3] comma-separated CIDRs from which X-Forwarded-For is honored; empty = don't trust XFF
VAULTCTL_STEP_UP_MAX_AGE=5m                 # [H10] max age of master-password reprompt proof for sensitive endpoints

# Trash
VAULTCTL_TRASH_RETENTION_DAYS=30              # Days before trashed items are permanently purged

# Clipboard & Session
VAULTCTL_CLIPBOARD_CLEAR_SECONDS=30           # Auto-clear clipboard after copying secrets (0 = disabled)
VAULTCTL_VAULT_LOCK_MINUTES=15                # Auto-lock vault after inactivity (0 = never)
VAULTCTL_MIN_PASSWORD_LENGTH=10               # Minimum master password length

# Backup
VAULTCTL_BACKUP_DIR=/backups                  # Directory for automated backups (inside container)
VAULTCTL_BACKUP_RETENTION_DAYS=90             # Days to keep backup files

# SMTP (optional — for invite emails)
VAULTCTL_SMTP_HOST=
VAULTCTL_SMTP_PORT=587
VAULTCTL_SMTP_USER=
VAULTCTL_SMTP_PASSWORD=
VAULTCTL_SMTP_FROM=noreply@vault.example.com

# Logging
VAULTCTL_LOG_LEVEL=info                     # debug | info | warn | error
VAULTCTL_LOG_FORMAT=json                    # json | text
VAULTCTL_LOG_IP_PRECISION=coarse            # [M1] coarse (truncate to /24 v4, /56 v6) | full | none — default coarse
VAULTCTL_LOG_REDACT_FIELDS=authHash,password,refresh_token,api_key,totp,masterKey,stretchedKey  # [C4] request-body fields stripped from every log line; enforced in logging middleware
```

---

## 12. CLI Commands

Entry point: `vaultctl <command>`

### 12.1 Command Reference

| Command | Description |
|---------|-------------|
| `vaultctl login` | Authenticate (interactive master password prompt) |
| `vaultctl logout` | End session |
| `vaultctl status` | Show current session status |
| `vaultctl get <name> [--field password\|username\|totp\|uri\|notes]` | Get item field (default: password) |
| `vaultctl list [--vault <name>] [--folder <name>] [--type login\|secure-note\|credit-card\|identity\|api-key\|ssh-key\|passkey]` | List items |
| `vaultctl create login --name <n> --username <u> --password <p> --uri <url>` | Create login item |
| `vaultctl create secure-note --name <n> --content <c>` | Create secure note |
| `vaultctl create credit-card --name <n> --number <num> --expiry <mm/yy> --cvv <c> [--cardholder <name>]` | Create credit card item |
| `vaultctl create identity --name <n> --first-name <f> --last-name <l> [--email <e>] [--phone <p>]` | Create identity item |
| `vaultctl create api-key --name <n> --key <k> [--env prod\|staging\|dev] [--expires <date>]` | Create API key item |
| `vaultctl create ssh-key --name <n> --private-key-file <path> [--passphrase <p>] [--host <h>]` | Create SSH key item |
| `vaultctl create passkey --name <n> --rp-id <domain> --credential-id <id> --public-key <key>` | Create passkey item (manual; typically created via browser extension WebAuthn relay) |
| `vaultctl edit <name> [--field value]` | Update item |
| `vaultctl delete <name> [--confirm]` | Soft delete item (move to trash) |
| `vaultctl trash list [--vault <name>]` | List items in trash |
| `vaultctl trash restore <name>` | Restore item from trash |
| `vaultctl trash purge [<name> \| --all]` | Permanently delete from trash |
| `vaultctl history <name>` | Show password history for login item |
| `vaultctl generate [--length 24] [--uppercase] [--digits] [--symbols] [--passphrase]` | Generate password |
| `vaultctl totp <name>` | Get current TOTP code for item |
| `vaultctl import --format bitwarden\|1password\|lastpass\|keepass --file <path>` | Import from file |
| `vaultctl export [--format json\|csv] --output <path>` | Export vault |
| `vaultctl api-key create --name <n> [--expires <duration>]` | Create API key for CLI/CI auth (prints full key once) |
| `vaultctl api-key list` | List API keys (shows prefix + name only) |
| `vaultctl api-key revoke <name>` | Revoke an API key |
| `vaultctl config set-server <url>` | Set server URL |
| `vaultctl config show` | Show current config |
| `vaultctl lock` | Lock the vault (clear session keys from memory) |
| `vaultctl unlock` | Unlock the vault (re-enter master password) |
| `vaultctl backup [--output <dir>]` | Create encrypted database backup |
| `vaultctl server` | Start the API server (used in Docker) |

### 12.2 Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General failure |
| `2` | Authentication failure |
| `3` | Item not found |
| `4` | Server unreachable |

### 12.3 CI/CD Usage

```bash
# Fetch a secret in a CI pipeline
export DB_PASSWORD=$(vaultctl get "Production DB" --field password)

# Using API key instead of interactive login
VAULTCTL_API_KEY=vk_abc123 vaultctl get "Deploy Token" --field password
```

---

## 13. Naming Conventions

### 13.1 Go Backend

| Element | Convention | Example |
|---------|-----------|---------|
| Packages | lowercase, single word | `vault`, `auth`, `postgres` |
| Files | `snake_case.go` | `create_item.go`, `vault_repository.go` |
| Structs | PascalCase | `VaultItem`, `CreateItemUseCase` |
| Interfaces | PascalCase, suffix with purpose | `VaultRepository`, `TokenService`, `EmailSender` |
| Use cases | `{Action}{Entity}UseCase` | `CreateItemUseCase`, `LoginUseCase` |
| Handlers | `{Entity}Handler` | `VaultHandler`, `AuthHandler` |
| DB models | `{Entity}Record` | `VaultItemRecord`, `UserRecord` |
| Test files | `*_test.go` (same package) | `create_item_test.go` |
| Errors | `Err{Description}` variable | `ErrItemNotFound`, `ErrUnauthorized` |

### 13.2 React Frontend

| Element | Convention | Example |
|---------|-----------|---------|
| Components | PascalCase | `VaultItemList.tsx`, `PasswordGenerator.tsx` |
| Hooks | camelCase, `use` prefix | `useVaultItems.ts`, `useAuth.ts` |
| API files | camelCase | `vaultApi.ts`, `authApi.ts` |
| Types | PascalCase, `Types.ts` suffix | `VaultTypes.ts`, `AuthTypes.ts` |
| Pages | PascalCase | `VaultPage.tsx`, `SettingsPage.tsx` |
| Feature slices | kebab-case folders | `features/item-editor/`, `features/password-generator/` |

### 13.3 Project-Wide

| Element | Convention | Example |
|---------|-----------|---------|
| API routes | `/api/v1/` prefix, kebab-case | `/api/v1/vault-items` |
| Env vars | `VAULTCTL_` prefix, SCREAMING_SNAKE | `VAULTCTL_DB_HOST` |
| Docker containers | `vaultctl-` prefix | `vaultctl-api`, `vaultctl-db` |
| DB tables | snake_case, plural | `vault_items`, `org_members` |
| DB columns | snake_case | `encrypted_data`, `created_at` |
| Migrations | `{timestamp}_{description}.sql` | `20260318120000_create_users.sql` |
| Git branches | `feat/VCT-{n}-description` | `feat/VCT-12-vault-sharing` |
| Commits | Conventional Commits | `feat(vault): add folder management` |

---

## 14. Testing Strategy

### 14.1 Coverage Requirements

| Layer | Minimum Coverage | Priority |
|-------|-----------------|----------|
| domain/ | **95%** | Critical — this is the core logic |
| application/ | **90%** | High — use case orchestration |
| infrastructure/ | **80%** | Medium — adapter correctness |
| presenters/api/ | **80%** | Medium — handler behavior |
| presenters/cli/ | **70%** | Lower — arg parsing, output format |
| **Global** | **85%** | CI gate |

### 14.2 Test Structure

```
internal/
├── domain/
│   └── vault/
│       ├── item.go
│       └── item_test.go              # Same package — unit test
├── application/
│   └── vault/
│       ├── create_item.go
│       └── create_item_test.go       # Mocked ports — use case test
├── infrastructure/
│   └── postgres/
│       ├── vault_repository.go
│       └── vault_repository_test.go  # Integration test with test DB
└── presenters/
    └── api/
        └── handlers/
            ├── vault_handler.go
            └── vault_handler_test.go  # HTTP test with httptest
```

### 14.3 What to Test

| Layer | What | How |
|-------|------|-----|
| **Domain** | Entity validation, value object constraints, domain errors | Pure unit tests, no mocks |
| **Application** | Use case logic, port interaction sequence, error propagation | Mock all ports via interfaces |
| **Infrastructure** | SQL queries, migrations, JWT generation, Argon2 hashing | Integration tests with testcontainers (PostgreSQL) |
| **API handlers** | Request parsing, response format, status codes, auth middleware | httptest with mocked use cases |
| **CLI** | Arg parsing, output format, exit codes | Capture stdout/stderr |
| **Frontend** | Component rendering, crypto operations, API calls | Vitest + React Testing Library |
| **Extension** | Auto-fill, popup interaction, background script messaging | Jest + Chrome extension test utils |

### 14.4 Security-Specific Tests

- Argon2id produces deterministic output for same input
- AES-256-GCM encrypt → decrypt roundtrip
- RSA encrypt with public → decrypt with private roundtrip
- Auth hash is not the master key (different HKDF context)
- Ciphertext changes with each encryption (random nonce, H9) — two back-to-back encryptions of identical plaintext under the same key produce distinct output
- Every stored ciphertext blob parses as `v1|alg_id|…` and `alg_id ∈ {0x01, 0x02, 0x03}` (C5)
- Server never receives plaintext secrets (API handler tests assert encrypted payloads)
- Rate limiting blocks after N attempts (per-IP AND per-email, H3)
- Per-email bucket blocks at 5 fails / 15min independently of source IP
- Locked account rejects login until lockout expires
- Prelogin returns indistinguishable response + timing for existing vs unknown emails (H2) — timing variance < 10ms p95
- Weak master password rejected on registration and password change
- **authHash never appears in log output (C4)** — grep over stdout, access logs, error traces after a test login
- `VAULTCTL_LOG_REDACT_FIELDS` values are stripped from every captured log line
- Reprompt flag enforces master password re-entry before secret reveal
- Step-up endpoints (H10) reject stale step-up claims (older than `VAULTCTL_STEP_UP_MAX_AGE`)
- Cross-vault IDOR test (H11): user A cannot read their own `itemId` by passing user B's `vaultId` in the URL — must 404
- TOTP replay test (H6): submitting the same code twice in the same 30s window is rejected the second time
- Soft-deleted items excluded from normal list queries
- Member removal rotates the vault key unconditionally (C2) — exiled member's cached vaultKey cannot decrypt post-removal items
- Wrapped-key signature verifies (H1): tampered `wrap_signature` causes recipient client to refuse decryption
- Public-key signature verifies (C1): a server-substituted public key is rejected by a wrapping client
- Invite token single-use (M11): second redemption returns 410 Gone
- Export envelope integrity (M6): swapping any item ciphertext in an export file breaks the envelope MAC
- Permanently purged items are irrecoverable (no DB row, no audit trail leak)
- Clipboard auto-clear fires after configured timeout
- Session auto-locks after inactivity period
- Custom fields and password history remain encrypted end-to-end
- Backup files contain only encrypted data (no plaintext secrets, no `.env` contents)
- Backup restore produces identical vault state

---

## 15. Quality Guidelines

### 15.1 Code Quality

- **No `any` / `interface{}`** — use typed structs and generics
- **Early return** over nested if/else
- **Error wrapping** — always wrap with context: `fmt.Errorf("create item: %w", err)`
- **No magic strings** — constants or enums for item types, roles, actions
- **No business logic in handlers** — handlers map HTTP → use case → HTTP
- **No SQL in use cases** — repositories abstract all data access
- **Comments** — explain why, not what. No obvious comments.

### 15.2 Linting & Static Analysis

| Tool | Purpose |
|------|---------|
| `golangci-lint` | Go linting (errcheck, govet, staticcheck, gocyclo, gosec) |
| `gosec` | Security-specific Go linting |
| `eslint` | Frontend linting |
| `prettier` | Frontend formatting |
| `hadolint` | Dockerfile linting |
| `commitlint` | Commit message enforcement |

### 15.3 Pre-Commit Hooks (via lefthook)

- `go vet ./...`
- `golangci-lint run`
- `go test ./...` (fast unit tests only)
- `commitlint` on commit message

---

## 16. CI/CD Workflows

### 16.1 CI (`ci.yml`) — On every PR

```
1. Lint (golangci-lint + eslint)
2. Unit tests (go test -race ./internal/...)
3. Integration tests (testcontainers PostgreSQL)
4. Frontend tests (vitest)
5. Build Go binary
6. Build frontend
7. Build Docker image (no push)
8. Coverage report + gate (85% minimum)
```

### 16.2 Quality (`quality.yml`) — On every PR

```
1. gosec (security scan)
2. govulncheck (dependency vulnerability scan)
3. npm audit (frontend dependencies)
4. hadolint (Dockerfile)
5. License compliance check
```

### 16.3 Release (`release.yml`) — On main merge

```
1. release-please (version bump, changelog, Git tag)
2. Build multi-arch Docker images (linux/amd64, linux/arm64)
3. Push to GHCR (ghcr.io/vineethkrishnan/vaultctl)
4. Push to Docker Hub (vineethkrishnan/vaultctl)
5. goreleaser: build standalone binaries (linux, darwin, windows)
6. Create GitHub Release with binaries + changelog
7. Deploy docs to Cloudflare Pages / GitHub Pages
```

### 16.4 Commitlint (`commitlint.yml`) — On every push

```
1. Validate commit messages against Conventional Commits
2. Enforce scope list: vault, auth, user, org, crypto, api, cli, web, ext, db, ci, docs, backup, trash
```

---

## 17. Docker & Deployment

### 17.1 Dockerfile (multi-stage)

```dockerfile
# Stage 1: Build Go binary
FROM golang:1.23-alpine AS backend-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o vaultctl ./cmd/server

# Stage 2: Build React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web/ .
RUN npm run build

# Stage 3: Production image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend-builder /app/vaultctl .
COPY --from=frontend-builder /app/dist ./web/dist
EXPOSE 8080
HEALTHCHECK CMD wget -q --spider http://localhost:8080/api/v1/health || exit 1
ENTRYPOINT ["./vaultctl", "server"]
```

### 17.2 docker-compose.yml (with TLS via Caddy)

```yaml
services:
  caddy:
    image: caddy:2-alpine
    container_name: vaultctl-caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - vaultctl
    restart: unless-stopped

  vaultctl:
    image: ghcr.io/vineethkrishnan/vaultctl:latest
    container_name: vaultctl
    env_file: .env
    expose:
      - "8080"
    depends_on:
      vaultctl-db:
        condition: service_healthy
    restart: unless-stopped

  vaultctl-db:
    image: postgres:16-alpine
    container_name: vaultctl-db
    environment:
      POSTGRES_DB: ${VAULTCTL_DB_NAME:-vaultctl}
      POSTGRES_USER: ${VAULTCTL_DB_USER:-vaultctl}
      POSTGRES_PASSWORD: ${VAULTCTL_DB_PASSWORD}
    volumes:
      - vaultctl-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${VAULTCTL_DB_USER:-vaultctl}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  vaultctl-data:
  caddy-data:
  caddy-config:
```

### 17.2.1 Caddyfile

```
{$VAULTCTL_BASE_URL:localhost} {
    reverse_proxy vaultctl:8080
}
```

Caddy automatically provisions and renews TLS certificates via Let's Encrypt when `VAULTCTL_BASE_URL` is set to a public domain. For local/LAN usage, Caddy generates a self-signed certificate automatically.

A `docker-compose.simple.yml` (without Caddy) is also provided for users who bring their own reverse proxy (nginx, Traefik, etc.) or run behind a load balancer.

### 17.3 Deployment

```bash
# 1. Clone
git clone https://github.com/vineethkrishnan/vaultctl && cd vaultctl

# 2. Configure
cp .env.example .env
# Edit .env — set VAULTCTL_BASE_URL to your domain (e.g., vault.example.com)

# 3. Run (with automatic TLS)
docker compose up -d

# Done. Open https://vault.example.com
```

### 17.4 Backup & Restore

#### Automated Backups

The vaultctl container includes a built-in backup command that creates encrypted PostgreSQL dumps:

```bash
# Manual backup
docker exec vaultctl ./vaultctl backup --output /backups/

# Automated via host cron (recommended)
# Add to crontab: daily at 2 AM
0 2 * * * docker exec vaultctl ./vaultctl backup --output /backups/ >> /var/log/vaultctl-backup.log 2>&1
```

#### Backup Contents

Each backup produces a single `.vaultctl-backup` file containing:
- Full PostgreSQL dump (pg_dump, custom format)
- Server configuration snapshot (non-secret env vars)
- Backup metadata (timestamp, version, checksum)

**Note:** Backup files contain encrypted vault data only — the server never has access to plaintext secrets. However, backups do contain auth hashes and encrypted private keys, so they should be stored securely and access-restricted.

#### ⚠ Backup / Server-Key Separation (M2)

Items encrypted under `VAULTCTL_DATA_ENCRYPTION_KEY` (TOTP secrets, password hints) can be decrypted offline by anyone holding both the DB backup **and** that key. The peppers in `VAULTCTL_SERVER_PEPPER` / `VAULTCTL_ENUMERATION_PEPPER` similarly devalue the DB dump only as long as they are not stored alongside it.

**Hard rules:**
1. `.env` (or any file containing `VAULTCTL_DATA_ENCRYPTION_KEY`, `VAULTCTL_SERVER_PEPPER`, `VAULTCTL_ENUMERATION_PEPPER`, `VAULTCTL_JWT_SECRET_CURRENT`) MUST NOT live in `VAULTCTL_BACKUP_DIR`.
2. DB backups and the server `.env` MUST be pushed to **different remote locations with different access policies** (e.g., DB → B2 bucket A, env → vault/1Password/SOPS repo).
3. `vaultctl backup` refuses to run if `VAULTCTL_BACKUP_DIR` resolves to a path containing any `.env*` file (CI-asserted).
4. Key rotation: `VAULTCTL_DATA_ENCRYPTION_KEY_NEXT` enables a dual-key window — server decrypts with either, re-encrypts writes with NEXT, then operator swaps NEXT → CURRENT and retires the old key.

#### Restore

```bash
# Stop the running instance
docker compose down

# Restore from backup
docker compose up -d vaultctl-db
docker exec vaultctl-db pg_restore -U vaultctl -d vaultctl < /backups/vaultctl-20260318.dump

# Restart
docker compose up -d
```

#### Backup Strategy Recommendations

| Scenario | Strategy |
|----------|----------|
| **Solo / homelab** | Daily cron backup to a second disk or NAS. Keep 30 days. |
| **Small team** | Daily backup + offsite copy (S3, Backblaze B2) via `rclone`. Keep 90 days. |
| **Critical** | Daily backup + offsite + weekly restore test in CI. |

#### Data Loss Warning

vaultctl uses zero-knowledge encryption. If all users lose their master passwords **and** no backup exists, data is **permanently irrecoverable**. There is no backdoor, no recovery key, no support process. Users should:
- Store a master password hint (Section 5.2)
- Keep an encrypted export (Section 5.6) in a separate location
- Test backup restores periodically

---

## 18. Future Scope (v2+)

### 18.1 Feature Roadmap

- Mobile apps (React Native or Flutter)
- SSO / SAML / LDAP for enterprise teams
- Hardware key authentication for vault login (YubiKey, FIDO2/WebAuthn as login method)
- Password breach monitoring (HaveIBeenPwned API)
- Secret sharing with expiring links
- Emergency access (trusted contact with time delay)
- Bitwarden API compatibility mode (use existing Bitwarden clients)
- Self-updating mechanism
- Prometheus metrics endpoint
- File attachments (encrypted binary storage for certificates, key files, documents)
- Tags (flexible item organization beyond folders)
- Individual item sharing (share single credentials without sharing entire vault)
- Duplicate detection (warn on items with matching URL/username)

### 18.2 Managed Cloud Offering (vaultctl Cloud)

For users who want vaultctl's zero-knowledge security model without operating the infrastructure, a managed cloud-hosted offering is planned post-v1. Core principles:

- **Same codebase, same guarantees:** Cloud runs the identical open-source vaultctl server — no proprietary fork, no hidden features. Zero-knowledge encryption is preserved: Vercel/operator never sees plaintext secrets.
- **Optional, never required:** Self-hosting remains the default and primary deployment model. Cloud is opt-in for users who prefer convenience over full control.
- **Portable:** Users can migrate between cloud and self-hosted at any time via encrypted export/import. No vendor lock-in.

#### Proposed Tiers

| Tier | Price | Limits |
|------|-------|--------|
| **Free** | $0 | 1 user, personal vault only, 50 items, community support |
| **Personal** | $3/mo | 1 user, unlimited items, multi-device sync, priority support |
| **Family** | $5/mo | Up to 5 users, shared family vault, emergency access |
| **Team** | $4/user/mo | Unlimited users, shared org vaults, audit log retention 90d, SSO (once available) |
| **Self-Hosted** | Free forever | All features, AGPL license, self-managed |

#### Architecture Additions (Cloud-Only)

- **Multi-tenancy:** Tenant isolation at the database level (schema-per-tenant or row-level security with tenant_id)
- **Billing integration:** Stripe for subscriptions, per-seat pricing, usage metering
- **Tenant provisioning:** Automated signup → tenant creation → onboarding flow
- **Operational tooling:** Tenant backup/restore, usage analytics (privacy-preserving — counts only, never content), abuse detection
- **Regional hosting:** EU + US regions for data residency
- **SLA & uptime monitoring:** 99.9% uptime target, public status page
- **Support portal:** Ticketing, knowledge base, in-app chat

#### Codebase Impact

The v1 architecture is designed to make a future cloud offering straightforward:

- **Hexagonal boundaries:** Billing, multi-tenancy, and observability can be added as new infrastructure adapters without changing domain or application layers.
- **No hardcoded single-tenant assumptions:** All queries already scope by `user_id` / `vault_id` / `org_id`. Adding `tenant_id` is additive.
- **Feature flags:** A `VAULTCTL_HOSTED_MODE` flag will gate cloud-only features (billing, tenant admin) so self-hosted instances never see them.
- **License compatibility:** AGPL-3.0 permits commercial hosting. Cloud revenue funds continued open-source development.

#### Open Questions (to resolve before cloud launch)

- Hosting platform: Vercel + managed Postgres, Fly.io, or AWS?
- Payment processor: Stripe, Paddle, or Lemon Squeezy?
- Legal entity and terms of service
- Data processing agreement (GDPR compliance)
- Free tier abuse mitigation (email verification, rate limits, captcha)

**Status:** This is a directional roadmap item, not committed scope. v1 ships as self-hosted only. Cloud launch depends on self-hosted traction and community feedback.

---

## 19. Success Metrics

| Metric | Target |
|--------|--------|
| Time to deploy | < 2 minutes (clone → compose up → working UI) |
| Test coverage | > 85% global |
| Lighthouse score (web UI) | > 90 performance, > 95 accessibility |
| CLI response time | < 200ms for `vaultctl get` |
| Docker image size | < 50MB (Go binary + static frontend) |
| Import success rate | 100% for supported formats |
| GitHub stars (6 months) | 500+ (measure adoption) |

---

## 20. Milestones

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 | Project scaffolding: Go module, folder structure, Makefile, Docker (with Caddy TLS), CI, linting, commitlint | 2 days |
| Phase 2 | Domain layer: entities (all 7 item types), value objects (custom fields, password history), crypto primitives, domain errors | 4 days |
| Phase 3 | Application layer: auth use cases (register, login, 2FA, password strength), vault CRUD use cases, trash use cases | 4 days |
| Phase 4 | Infrastructure: PostgreSQL repos, migrations (soft delete, reprompt), JWT service, Argon2 hasher, backup service | 3 days |
| Phase 5 | API layer: REST handlers (including trash endpoints), middleware (auth, rate limit, CORS), DTOs | 3 days |
| Phase 6 | Frontend: React scaffold, auth pages, vault UI (all item types, custom fields, password history), password generator, item editor, trash view, clipboard auto-clear, auto-lock | 6 days |
| Phase 7 | Organizations: multi-user, shared vaults, invite flow, role management | 3 days |
| Phase 8 | Import/Export: Bitwarden, 1Password, LastPass, KeePass parsers (map to new item types) | 3 days |
| Phase 9 | CLI: all commands (including trash, history, backup, lock/unlock), API key auth, CI/CD integration | 3 days |
| Phase 10 | Browser extension: Chrome + Firefox, auto-fill, popup, TOTP copy, passkey WebAuthn relay, clipboard clear, auto-lock | 6 days |
| Phase 11 | Security hardening: rate limiting, audit logging, session management, CSP, master password strength enforcement, reprompt flow | 3 days |
| Phase 12 | Backup/restore: backup command, restore procedure, CI restore test, documentation | 2 days |
| Phase 13 | Docker publishing, goreleaser, release workflow, docs site | 2 days |
| Phase 14 | Integration tests, E2E tests, security tests, load testing, backup restore tests | 3 days |
| **Total** | | **~47 days** |
