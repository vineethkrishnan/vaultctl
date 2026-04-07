# Architecture & Implementation Milestones: vaultctl

**Version:** 1.0
**Date:** April 4, 2026
**Status:** Draft
**Companion to:** `prd.md`

---

## 1. Purpose

This document is the technical blueprint for implementing vaultctl v1. It complements the PRD by providing:

- Deeper architectural rationale and trade-off analysis
- Component-level design with interaction diagrams
- Cryptographic flow sequences
- Milestone plan with dependencies, deliverables, and acceptance criteria
- Risk register and critical path analysis

Engineers should read the PRD first for product context, then use this document to drive implementation.

---

## 2. Architectural Principles

### 2.1 Core Principles

| Principle | Manifestation |
|-----------|---------------|
| **Zero-knowledge by construction** | Encryption happens before data leaves the client. Server code cannot accidentally see plaintext — it has no code path to decrypt. |
| **Hexagonal boundaries** | Domain logic has zero framework/infrastructure imports. All I/O goes through ports. Testable in isolation. |
| **Cloud-portable foundation** | No single-tenant assumptions in domain or application layers. `tenant_id` can be added as an additive infrastructure concern. |
| **Fail closed, fail loud** | On any cryptographic or authorization error, deny access and log. Never silently degrade. |
| **Client parity** | Web UI, CLI, and browser extension share the same crypto primitives and API contract. No client gets special privileges. |
| **Reversible deletes** | Soft delete is the default. Permanent destruction requires explicit user intent. |

### 2.2 Trade-offs Made

| Decision | Alternative | Why |
|----------|-------------|-----|
| **Go backend** | Rust (Vaultwarden), Node.js | Readable, single binary, great stdlib crypto, easy for contributors |
| **PostgreSQL only** | MySQL, SQLite, multi-DB | One well-supported DB reduces maintenance. Postgres `pgcrypto`, JSON, partial indexes are worth the lock-in. |
| **RSA-2048 for key wrapping** | X25519/ECDH | RSA is ubiquitous, Web Crypto API has first-class support. X25519 is future upgrade path. |
| **Argon2id client-side** | Server-side hashing only | Client-side KDF is required for zero-knowledge — server never sees master password. |
| **chi router** | gin, echo, fiber | stdlib-compatible, small surface, no magic. Handlers are plain `http.HandlerFunc`. |
| **React + Vite** | Next.js, SvelteKit, Solid | SPA is the right fit for a vault (client-heavy, low SEO need). Vite build is fast, deploys as static files. |
| **Cobra for CLI** | urfave/cli, stdlib flag | Cobra is the de-facto Go CLI framework (used by kubectl, gh). Familiar for contributors. |
| **Monorepo** | Multi-repo (backend/web/ext separate) | Single source of truth, atomic PRs across layers, simpler CI |

---

## 3. System Architecture

### 3.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                             CLIENTS                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │   Web UI     │  │   Browser    │  │     CLI      │               │
│  │  (React SPA) │  │   Extension  │  │   (Cobra)    │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                  │                  │                       │
│  ┌──────┴──────────────────┴──────────────────┴──────┐              │
│  │              Shared Crypto Module                  │              │
│  │  (AES-GCM, Argon2id, HKDF, RSA — Web Crypto API)  │              │
│  └──────────────────────┬─────────────────────────────┘              │
└─────────────────────────┼────────────────────────────────────────────┘
                          │ HTTPS (encrypted payloads only)
                          │
┌─────────────────────────┼────────────────────────────────────────────┐
│                    REVERSE PROXY                                      │
│                    (Caddy / nginx)                                    │
│                    - TLS termination                                  │
│                    - HSTS, CSP headers                                │
└─────────────────────────┼────────────────────────────────────────────┘
                          │
┌─────────────────────────┼────────────────────────────────────────────┐
│                    GO API SERVER                                      │
│                                                                       │
│   ┌────────────────────────────────────────────────────┐             │
│   │  presenters/api (HTTP handlers, middleware, DTOs)   │             │
│   └──────────────────────┬─────────────────────────────┘             │
│                          │                                            │
│   ┌──────────────────────┴─────────────────────────────┐             │
│   │  application (use cases, ports)                     │             │
│   └──────────────────────┬─────────────────────────────┘             │
│                          │                                            │
│   ┌──────────────────────┴─────────────────────────────┐             │
│   │  domain (entities, value objects — pure Go)        │             │
│   └────────────────────────────────────────────────────┘             │
│                          ▲                                            │
│   ┌──────────────────────┴─────────────────────────────┐             │
│   │  infrastructure (Postgres, JWT, Argon2, SMTP)       │             │
│   └──────────────────────┬─────────────────────────────┘             │
└─────────────────────────┼────────────────────────────────────────────┘
                          │
             ┌────────────┴────────────┐
             │                          │
     ┌───────┴────────┐        ┌───────┴────────┐
     │  PostgreSQL 16 │        │  SMTP (opt.)   │
     │  (ciphertext)  │        │  (invites)     │
     └────────────────┘        └────────────────┘
```

### 3.2 Layer Responsibilities

| Layer | Owns | Does Not Own |
|-------|------|--------------|
| **domain** | Business rules, invariants, entity validation | I/O, HTTP, SQL, framework code |
| **application** | Use case orchestration, transaction boundaries, port contracts | Entity internals, HTTP shape, SQL dialect |
| **infrastructure** | SQL queries, JWT encoding, Argon2 implementation, SMTP | Business rules, HTTP request parsing |
| **presenters/api** | HTTP routing, request parsing, response shaping, status codes | Business rules, SQL |
| **presenters/cli** | Argument parsing, stdout formatting, exit codes | Business rules, SQL, HTTP |

### 3.3 Dependency Rule (Strictly Enforced)

```
  presenters ──→ application ──→ domain
                      ↑
  infrastructure ─────┘
```

- `domain/` has zero imports from `application/`, `infrastructure/`, `presenters/`
- `application/` imports only `domain/`
- `infrastructure/` imports `application/ports/` + `domain/`
- `presenters/` imports `application/` use cases

**Enforcement:** `golangci-lint` with `depguard` rule blocks forbidden imports at CI time.

---

## 4. Critical Flow Sequences

### 4.1 User Registration (Zero-Knowledge Setup)

```
Client                              Server                        DB
  │                                    │                           │
  │  1. Enter email + master pwd       │                           │
  │  2. Generate salt (random 16 bytes)│                           │
  │  3. Derive masterKey =             │                           │
  │     Argon2id(pwd, salt)            │                           │
  │  4. Derive authHash =              │                           │
  │     HKDF(masterKey, "auth")        │                           │
  │  5. Derive stretchedKey =          │                           │
  │     HKDF(masterKey, "enc")         │                           │
  │  6. Generate RSA-2048 keypair      │                           │
  │     (used for vault SHARING only)  │                           │
  │  7. [C1] Generate Ed25519 identity │                           │
  │     keypair (idPub, idPriv)        │                           │
  │  8. pubKeySig =                    │                           │
  │     Ed25519-Sign(idPriv, pubKey)   │                           │
  │  9. encPrivKey =                   │                           │
  │     AES-GCM-v1(stretchedKey,privKey)│                          │
  │ 10. encIdentityPrivKey =           │                           │
  │     AES-GCM-v1(stretchedKey,idPriv)│                           │
  │ 11. Generate vaultKey (random 32B) │                           │
  │ 12. [M4] For PERSONAL vault use    │                           │
  │     AES-KW direct wrap:            │                           │
  │     encVaultKey =                  │                           │
  │     AES-KW-v1(stretchedKey,vaultKey)│ ← no RSA round-trip       │
  │                                    │     (shared vaults use    │
  │                                    │      RSA-OAEP path, see   │
  │                                    │      §4.4)                │
  │ 13. [M12] Generate Recovery Kit:   │                           │
  │     recoveryKey = rand(32B)        │                           │
  │     recoveryWrappedPrivKey =       │                           │
  │     AES-GCM-v1(recoveryKey,privKey)│                           │
  │     Show ONCE to user, confirm     │                           │
  │                                    │                           │
  │  POST /auth/register               │                           │
  │  {email, authHash, salt, kdf_params,                           │
  │   encPrivKey, pubKey, pubKeySig,   │                           │
  │   identityPubKey,                  │                           │
  │   encIdentityPrivKey,              │                           │
  │   encVaultKey (alg_id=0x03),       │                           │
  │   recoveryWrappedPrivKey}          │                           │
  ├───────────────────────────────────→│                           │
  │                                    │  INSERT users             │
  │                                    ├──────────────────────────→│
  │                                    │  INSERT vaults (personal) │
  │                                    ├──────────────────────────→│
  │                                    │  INSERT vault_members     │
  │                                    │  (wrap_sender_id=self,    │
  │                                    │   wrap_signature=         │
  │                                    │   Ed25519(idPriv,…))      │
  │                                    ├──────────────────────────→│
  │  201 Created + JWT tokens          │                           │
  │←───────────────────────────────────┤                           │
```

**Notes:**
- All `encXxx` blobs carry the `v1|alg_id|…` header defined in PRD §9.9 (C5).
- `authHash` is stripped from request logs by the redaction middleware (C4).
- Recovery Kit payload is never sent to the server; only `recoveryWrappedPrivKey` is persisted server-side as part of the user record for later recovery use (M12).

### 4.2 Login (Authentication)

```
Client                              Server                        DB
  │                                    │                           │
  │  GET /auth/prelogin?email=...      │                           │
  ├───────────────────────────────────→│                           │
  │                                    │  Enforce per-email         │
  │                                    │  bucket (H3)              │
  │                                    │  SELECT salt, kdf_params  │
  │                                    ├──────────────────────────→│
  │                                    │←──────────────────────────┤
  │                                    │  [H2] If email unknown:   │
  │                                    │   salt = HMAC(            │
  │                                    │     enumeration_pepper,   │
  │                                    │     lower(email))         │
  │                                    │   kdf_params = defaults   │
  │                                    │   (identical response     │
  │                                    │    shape + timing budget) │
  │  200 {salt, iterations, memory,    │                           │
  │       parallelism}                 │                           │
  │←───────────────────────────────────┤                           │
  │                                    │                           │
  │  1. Derive masterKey locally       │                           │
  │  2. Compute authHash               │                           │
  │                                    │                           │
  │  POST /auth/login                  │                           │
  │  {email, authHash}                 │                           │
  │  [C4] authHash is stripped from    │                           │
  │  all logs by redaction middleware  │                           │
  ├───────────────────────────────────→│                           │
  │                                    │  Enforce per-IP + per-email│
  │                                    │  buckets + global breaker │
  │                                    │  SELECT auth_hash         │
  │                                    ├──────────────────────────→│
  │                                    │  Compare (constant-time)  │
  │                                    │  Check lockout status     │
  │                                    │  If 2FA: require TOTP     │
  │                                    │  (verify counter > last, H6)│
  │                                    │  Issue refresh_token      │
  │                                    │  INSERT sessions with     │
  │                                    │    refresh_token_hash =   │
  │                                    │    HMAC(server_pepper,    │
  │                                    │         refresh_token)    │
  │                                    │    [C3]                   │
  │                                    ├──────────────────────────→│
  │  200 {access_token, refresh_token, │                           │
  │       encPrivKey, encIdentityPrivKey,                          │
  │       vaultKeys:[{encVaultKey,     │                           │
  │        wrap_sender_id, wrap_sig}…],│                           │
  │       members:[{userId, pubKey,    │                           │
  │        pubKeySig, identityPubKey}…]│                           │
  │  }                                 │                           │
  │←───────────────────────────────────┤                           │
  │                                    │                           │
  │  3. [C1] Verify pubKeySig for every│                           │
  │     member pubKey against their    │                           │
  │     pinned identityPubKey;         │                           │
  │     prompt user on TOFU mismatch.  │                           │
  │  4. Decrypt privKey & idPriv with  │                           │
  │     stretchedKey                   │                           │
  │  5. [H1] Verify wrap_signature for │                           │
  │     every wrapped vaultKey         │                           │
  │     against sender's identityPubKey│                           │
  │  6. Decrypt each vaultKey          │                           │
  │     (personal: AES-KW; shared: RSA)│                           │
  │  7. Keys held in memory only       │                           │
  │     (Web Worker scope, M9)         │                           │
```

### 4.3 Item Creation

```
Client                              Server                        DB
  │                                    │                           │
  │  User edits item in UI             │                           │
  │  1. Serialize item to JSON         │                           │
  │  2. encryptedData =                │                           │
  │     AES-GCM(vaultKey, json)        │                           │
  │  3. encryptedName =                │                           │
  │     AES-GCM(vaultKey, name)        │                           │
  │                                    │                           │
  │  POST /vaults/:id/items            │                           │
  │  {encryptedData, encryptedName,    │                           │
  │   itemType, reprompt, favorite}    │                           │
  ├───────────────────────────────────→│                           │
  │                                    │  Validate vault access    │
  │                                    │  INSERT vault_items       │
  │                                    ├──────────────────────────→│
  │                                    │  INSERT audit_log         │
  │                                    ├──────────────────────────→│
  │  201 {id, created_at}              │                           │
  │←───────────────────────────────────┤                           │
```

### 4.4 Vault Sharing with Another User

```
Sender                              Server                   Recipient
  │                                    │                           │
  │  GET /orgs/:id/members/:userId/pubkey                         │
  ├───────────────────────────────────→│                           │
  │  200 {publicKey, publicKeySignature,                           │
  │       identityPublicKey}           │                           │
  │←───────────────────────────────────┤                           │
  │                                    │                           │
  │  1. [C1] Verify publicKeySignature │                           │
  │     against identityPublicKey.     │                           │
  │     If TOFU-pinned id key differs  │                           │
  │     from returned one → show       │                           │
  │     "safety number changed" UI     │                           │
  │     and ABORT until user confirms. │                           │
  │  2. encSharedKey =                 │                           │
  │     v1|0x02|RSA-OAEP(              │                           │
  │       recipientPubKey, vaultKey)   │                           │
  │  3. [H1] wrapSig =                 │                           │
  │     Ed25519-Sign(senderIdPriv,     │                           │
  │       vaultId ∥ recipientUserId ∥  │                           │
  │       encSharedKey)                │                           │
  │                                    │                           │
  │  POST /vaults/:vaultId/members     │                           │
  │  {userId, encSharedKey,            │                           │
  │   wrap_sender_id=senderId,         │                           │
  │   wrap_signature=wrapSig}          │                           │
  ├───────────────────────────────────→│                           │
  │                                    │  Verify sender ∈ vault    │
  │                                    │  with share permission    │
  │                                    │  INSERT vault_members     │
  │  200 OK                            │                           │
  │←───────────────────────────────────┤                           │
  │                                    │                           │
  │                                    │  Recipient logs in        │
  │                                    │←──────────────────────────┤
  │                                    │  Returns encSharedKey +   │
  │                                    │  wrap_sig + sender_id     │
  │                                    ├──────────────────────────→│
  │                                    │                           │
  │                                    │  [H1] Verify wrap_sig w/  │
  │                                    │  sender's idPubKey        │
  │                                    │  (fetch + verify against  │
  │                                    │   pinned key, C1). Reject │
  │                                    │  if mismatch.             │
  │                                    │  Decrypt with own privKey │
  │                                    │  Now can access vault     │
```

**Member removal / role downgrade (C2):**

```
Admin                               Server                        DB
  │  DELETE /orgs/:id/members/:userId                              │
  ├───────────────────────────────────→│                           │
  │                                    │  UPDATE vault_members     │
  │                                    │  SET removed_at=NOW()     │
  │                                    │  WHERE user_id=:userId    │
  │                                    ├──────────────────────────→│
  │                                    │  INSERT audit_log         │
  │                                    │    (member_removed)       │
  │                                    ├──────────────────────────→│
  │  200 {rekeyJobId, affectedVaults}  │                           │
  │←───────────────────────────────────┤                           │
  │                                    │                           │
  │  For each affected vault:          │                           │
  │    newVaultKey = rand(32B)         │                           │
  │    For each item in vault:         │                           │
  │      newCt = AES-GCM(              │                           │
  │        newVaultKey,                │                           │
  │        decrypt(oldVaultKey, ct))   │                           │
  │    For each remaining member m:    │                           │
  │      newWrapped =                  │                           │
  │        RSA-OAEP(m.pubKey,          │                           │
  │                newVaultKey)        │                           │
  │      wrap_sig = Ed25519(…)         │                           │
  │                                    │                           │
  │  PUT /vaults/:id/rekey             │                           │
  │  {items:[{id,newCiphertext,…}],    │                           │
  │   members:[{id,newWrapped,wrapSig}]}                           │
  ├───────────────────────────────────→│                           │
  │                                    │  TX: UPDATE items + members│
  │                                    ├──────────────────────────→│
  │  200 OK                            │                           │
  │←───────────────────────────────────┤                           │
```

This runs for EVERY member removal or role downgrade (C2) — not conditional on write access.

---

## 5. Data Architecture

### 5.1 Entity Relationship Overview

```
    ┌──────────┐        ┌──────────────────┐       ┌──────────────┐
    │  users   │────┬──→│   vault_members  │←──────│    vaults    │
    └──────────┘    │   └──────────────────┘       └──────┬───────┘
         │          │                                      │
         │          │   ┌──────────┐                       │
         │          └──→│ api_keys │                       │
         │              └──────────┘                       │
         │                                                 ▼
         │          ┌──────────────┐             ┌──────────────┐
         │          │   sessions   │             │ vault_items  │
         │          └──────────────┘             └──────┬───────┘
         │                                              │
         ▼                                              ▼
    ┌──────────┐      ┌────────────┐           ┌──────────────┐
    │audit_logs│      │org_members │           │   folders    │
    └──────────┘      └────────────┘           └──────────────┘
                          │
                          ▼
                      ┌──────────────┐
                      │organizations │
                      └──────────────┘
```

### 5.2 Encryption Field Map

All encrypted fields use the versioned blob format from PRD §9.9 (`v1|alg_id|…`) unless noted (C5).

| Field | alg_id | Key Used | Notes |
|-------|--------|----------|-------|
| `users.auth_hash` | — (Argon2id digest, not a blob) | — | Server re-hashes the client-provided authHash with Argon2id |
| `users.salt` | — | — | Argon2 salt (client-derivation input, not encrypted) |
| `users.encrypted_private_key` | `0x01` (AES-256-GCM) | User's stretchedKey | RSA priv key — decrypted only on client |
| `users.encrypted_identity_private_key` | `0x01` (AES-256-GCM) | User's stretchedKey | [C1] Ed25519 identity priv key |
| `users.identity_public_key` | — (plaintext) | — | [C1] Ed25519 identity pub key — displayed as safety number for TOFU |
| `users.public_key` | — (plaintext) | — | [C1] RSA-2048 pub key, sharing use. Verified against identity key via `public_key_signature` before use |
| `users.public_key_signature` | — (Ed25519 sig bytes) | — | [C1] Signed by user's identity priv key over `public_key` |
| `users.totp_secret` | `0x01` (AES-256-GCM) | **`VAULTCTL_DATA_ENCRYPTION_KEY`** | [H5] Server encrypts so server can verify. Key lives outside the DB backup per §17.4 (M2). Supports dual-key rotation. |
| `users.encrypted_password_hint` | `0x01` (AES-256-GCM) | `VAULTCTL_DATA_ENCRYPTION_KEY` | [H4] was plaintext; now encrypted with the same server key as TOTP |
| `vault_members.encrypted_vault_key` (shared) | `0x02` (RSA-OAEP) | Recipient's RSA pub key | Server never sees plaintext vault key |
| `vault_members.encrypted_vault_key` (personal) | `0x03` (AES-KW) | User's stretchedKey | [M4] direct key-wrap — skips RSA round-trip for single-user vaults |
| `vault_members.wrap_signature` | — (Ed25519 sig bytes) | — | [H1] Binds `(vault_id, user_id, encrypted_vault_key)` to sender's identity key |
| `vault_items.encrypted_data` | `0x01` (AES-256-GCM) | Vault key | Contains item payload, custom fields, password history |
| `vault_items.encrypted_name` | `0x01` (AES-256-GCM) | Vault key | Name encrypted + padded to next 32B boundary (M5) |
| `folders.encrypted_name` | `0x01` (AES-256-GCM) | Vault key | Padded to next 32B boundary (M5) |
| `api_keys.key_hash` | — (HMAC digest) | `VAULTCTL_SERVER_PEPPER` | [H7] `HMAC-SHA256(pepper, full_api_key)` — was raw SHA-256 |
| `sessions.refresh_token_hash` | — (HMAC digest) | `VAULTCTL_SERVER_PEPPER` | [C3] `HMAC-SHA256(pepper, refresh_token)` — raw refresh token never persisted |

**Nonce policy (H9):** AES-GCM nonces are 96-bit cryptographically random (`crypto/rand`). No counter-mode nonces. Vault-key rotation trigger fires at 2^28 encryptions per key OR annually.

### 5.3 Data Retention

| Data | Retention | Purge Mechanism |
|------|-----------|-----------------|
| Vault items (active) | Forever | User-initiated delete |
| Vault items (trashed) | 30 days | Daily cron job purges `deleted_at < NOW() - INTERVAL '30 days'` |
| Sessions | Until refresh token expiry (7d) | Cron: delete `expires_at < NOW()` |
| Audit logs — raw `ip_address` + `user_agent` | 30 days | [M1] Cron: `UPDATE audit_logs SET ip_address=NULL, user_agent=NULL WHERE created_at < NOW() - INTERVAL '30 days'` |
| Audit logs — action trail | 365 days | Cron: delete `created_at < NOW() - INTERVAL '1 year'` |
| Failed login counters | Until lockout expires | Reset on successful login |
| Invite tokens | ≤72h TTL, single-use | Cron: delete `expires_at < NOW() OR used_at IS NOT NULL` |
| Removed vault members (soft-deleted) | Forever (audit trail) | [M3] No purge — kept with `removed_at` set |

**IP logging (M1):** `ip_address` is written per `VAULTCTL_LOG_IP_PRECISION`:
- `coarse` (default): truncated to /24 (IPv4) or /56 (IPv6) at write time.
- `full`: full IP (explicit opt-in, e.g., for SIEM forensics).
- `none`: NULL'd at write time.

---

## 6. Security Architecture Details

### 6.1 Key Hierarchy

```
Master Password (user memory)
       │
       │ Argon2id(salt, iter=3, mem=64MB, par=4)
       ▼
Master Key (256-bit, client memory only)
       │
       ├─ HKDF-SHA256(ctx="enc") ──→ Stretched Key ──→ Decrypts User's RSA Private Key
       │                                                       │
       │                                                       ▼
       │                                         User's RSA Private Key
       │                                                       │
       │                                                       ▼
       │                                         Decrypts Vault Keys (per vault)
       │                                                       │
       │                                                       ▼
       │                                         Vault Keys (AES-256 per vault)
       │                                                       │
       │                                                       ▼
       │                                         Decrypts Vault Items
       │
       └─ HKDF-SHA256(ctx="auth") ──→ Auth Hash ──→ Sent to Server for Login
```

### 6.2 Attack Surface Analysis

| Component | Attack Surface | Mitigation |
|-----------|---------------|------------|
| **Browser (Web UI)** | XSS, malicious extensions, memory scraping | [M8] Exact CSP locked below, no `dangerouslySetInnerHTML`, SRI on assets, clipboard auto-clear. Because v1 uses header-only auth (M7) and holds decrypted keys in a Web Worker (M9), a single XSS is an account-takeover event — CSP is load-bearing. |
| **Browser extension** | Malicious pages, content script injection | Content scripts run in isolated world, strict origin checks, minimal permissions |
| **API server** | Injection, auth bypass, DoS | Parameterized queries, JWT validation middleware, rate limiting, input validation |
| **Database** | Dump theft, replica leak | All sensitive fields encrypted, TDE at rest (operator responsibility) |
| **Network** | MITM, replay | TLS 1.3 required, HSTS, refresh token rotation |
| **Backup files** | Theft, cold data leak | Contain only ciphertext; operator responsibility to secure storage |

### 6.3 Secure Defaults

- TLS **required** in production mode — server refuses to start on HTTP if `VAULTCTL_ENV=production`
- Registration defaults to **invite-only**
- **Rate limiting (H3)** — three layers:
  - Per-IP: **60 req/min** (generic) + **30 req/min** on `/api/v1/auth/*`
  - Per-email: **5 attempts / 15 min** on `/auth/login` and `/auth/prelogin` (persisted via `users.failed_login_attempts`)
  - Global circuit breaker: if total failed auths > `VAULTCTL_AUTH_GLOBAL_ALERT_THRESHOLD`/min → emit alert, temporarily halve per-IP and per-email limits
  - `X-Forwarded-For` honored only from `VAULTCTL_TRUSTED_PROXIES` CIDRs
  - v1 uses in-memory limiter + DB-backed failed-login counters; cloud tier will swap to Redis
- JWT access token **15 minutes**, refresh **7 days**. Signing uses `VAULTCTL_JWT_SECRET_CURRENT` with `kid=VAULTCTL_JWT_KID_CURRENT`; verification accepts both `_CURRENT` and `_NEXT` (H8)
- **Step-up auth (H10):** reprompt proofs valid ≤ `VAULTCTL_STEP_UP_MAX_AGE` (default 5m) required for password change, API-key create/revoke, full export, backup trigger, trash purge
- Argon2id params: **3 iterations, 64MB, 4 parallelism** (OWASP recommendation)
- Vault auto-lock: **15 minutes**
- Clipboard auto-clear: **30 seconds**

### 6.4 CSP & Security Headers (M8)

Committed CSP on all HTML responses (tuned for hash-wasm Argon2id):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

Accompanying headers (set by Go middleware + asserted by Caddyfile):

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: interest-cohort=(), geolocation=(), camera=(), microphone=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-site
X-Frame-Options: DENY
```

### 6.5 Logging Redaction (C4)

Every log line — `slog` record, access log, error trace — passes through a redaction layer that strips fields listed in `VAULTCTL_LOG_REDACT_FIELDS` (default includes `authHash`, `password`, `refresh_token`, `api_key`, `totp`, `masterKey`, `stretchedKey`).

- Implemented as a `slog.Handler` wrapper (`internal/infrastructure/logging/redact.go`).
- Applied to ALL handlers — production and dev.
- Caddy body-logging is OFF for `/api/v1/auth/*` (documented in Caddyfile).
- CI security test: boots the server, logs in a test user, greps the captured output — fail if `authHash` appears.

---

## 7. Deployment Architecture

### 7.1 Self-Hosted Deployment (v1)

```
┌─────────────────────────────────────────────────────────────┐
│                      Host / VM / Homelab                     │
│                                                              │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐     │
│  │   Caddy     │──→│   vaultctl   │──→│  postgres    │     │
│  │  :80, :443  │   │    :8080     │   │    :5432     │     │
│  └─────────────┘   └──────────────┘   └──────────────┘     │
│         │                 │                   │             │
│  ┌──────┴──────┐   ┌─────┴──────┐    ┌───────┴─────┐      │
│  │ caddy-data  │   │ (stateless)│    │ vaultctl-   │      │
│  │ caddy-config│   │            │    │    data     │      │
│  └─────────────┘   └────────────┘    └─────────────┘      │
│                                                              │
│  Docker Compose network: vaultctl-net                        │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Future Cloud Deployment (Post-v1)

```
┌───────────────────────────────────────────────────────────────┐
│                     Cloud Provider (Region: EU/US)             │
│                                                                │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   │
│  │   CDN/   │──→│  vaultctl│──→│ managed  │──→│ managed  │   │
│  │  Edge    │   │  (N pods)│   │ Postgres │   │  Redis   │   │
│  │          │   │          │   │ (multi-AZ)│  │ (rate    │   │
│  │          │   │          │   │          │   │ limiting)│   │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘   │
│                      │                                         │
│                      ├──→ Stripe (billing)                    │
│                      ├──→ SendGrid (transactional email)      │
│                      └──→ Sentry (error tracking)             │
└───────────────────────────────────────────────────────────────┘
```

Additions vs self-hosted:
- `tenant_id` column added to all multi-tenant tables via migration
- Row-level security policies enforce tenant isolation
- `VAULTCTL_HOSTED_MODE=true` enables billing, tenant admin, abuse detection endpoints
- Horizontal scaling: stateless API pods, shared Postgres

---

## 8. Implementation Milestones

Milestones are ordered by dependency. Each milestone has **deliverables** (what gets built), **acceptance criteria** (how we know it's done), and **unblocks** (what becomes possible).

### Milestone 0: Project Scaffolding (2 days)

**Deliverables:**
- Go module initialized (`go 1.23`), folder structure matching Section 6.2 of PRD
- Tooling wiring: `chi`, `slog`, `caarlos0/env`, `golang-migrate` imported and verified
- `Makefile` with targets: `build`, `test`, `lint`, `run`, `docker-build`, `sqlc`
- `.golangci.yml` with `depguard`, `gosec`, `govet`, `staticcheck`, `errcheck`, `gocyclo`
- `lefthook.yml` pre-commit hooks
- GitHub Actions: `ci.yml`, `quality.yml`, `commitlint.yml`
- Dockerfile (multi-stage), docker-compose.yml with Caddy + Postgres
- `docker-compose.simple.yml` (no Caddy)
- `.env.example` and `Caddyfile`
- `sqlc.yaml` config stub

**Acceptance Criteria:**
- `make build` produces a binary
- `make lint` passes
- `docker compose up` starts an empty server that returns 200 on `/api/v1/health`
- CI runs on PR, commitlint blocks malformed messages
- `golangci-lint` fails the build if `domain/` imports anything external

**Unblocks:** All subsequent milestones

---

### Milestone 1: Domain Layer (4 days)

**Deliverables:**
- `internal/domain/vault/`: Item, ItemType, Folder, Vault, CustomField, PasswordHistory value objects
- `internal/domain/user/`: User, Role, Session
- `internal/domain/organization/`: Organization, Membership
- `internal/domain/crypto/`: SymmetricKey, KeyPair, EncryptedBlob, PasswordHash
- Domain errors for each aggregate
- All 7 item types with validation rules

**Acceptance Criteria:**
- Zero imports outside Go stdlib (enforced by depguard)
- 95%+ unit test coverage
- All entity invariants have failing tests (negative cases)
- Item type switching enforces required fields per type

**Unblocks:** Application layer, infrastructure layer

---

### Milestone 2: Crypto Primitives + Auth Use Cases (4 days)

**Deliverables:**
- `internal/infrastructure/auth/`: Argon2id hasher (`golang.org/x/crypto/argon2`), JWT service (`golang-jwt/jwt/v5`), TOTP service (`pquerna/otp`), session store
- `internal/infrastructure/secure/`: `memguard` wrappers for master keys, stretched keys, vault keys
- `internal/application/auth/`: Register, Login, RefreshToken, SetupTOTP, VerifyTOTP, ChangePassword, ManageAPIKeys use cases
- Port interfaces: UserRepository, SessionStore, TokenService, APIKeyRepository
- Master password strength validator (length + common-password list)
- Constant-time auth hash comparison (`crypto/subtle`)

**Acceptance Criteria:**
- 90%+ use case coverage
- Crypto round-trip tests pass (Argon2id determinism, AES-GCM encrypt/decrypt)
- Weak master passwords rejected (< 10 chars, common list hits)
- JWT tokens validate and expire correctly
- Security test: auth hash is never the master key

**Unblocks:** API auth endpoints, login flow

**Risk:** Argon2id memory cost (64MB) may be too slow on cheap VPS. Mitigation: make KDF params per-user configurable.

---

### Milestone 3: Vault Use Cases (4 days)

**Deliverables:**
- `internal/application/vault/`: CreateItem, GetItem, UpdateItem, DeleteItem (soft), ListItems, SearchItems, ManageFolders, ShareVault, TrashItem (restore/purge), GetPasswordHistory
- Port interfaces: VaultRepository
- Authorization checks (user must be member of vault)
- Soft delete logic with trash retention

**Acceptance Criteria:**
- 90%+ coverage
- Users cannot access vaults they are not members of (tests enforce)
- **Cross-vault IDOR guard (H11):** every item handler verifies BOTH `user ∈ vault_members(vaultId, removed_at IS NULL)` AND `item.vault_id == :vaultId`. Test: user A passes their own `itemId` alongside user B's `vaultId` → handler returns 404 (never reveals item existence).
- Deleted items appear in trash list, not in active list
- Restored items return to original folder (or root if folder deleted)

**Unblocks:** Vault API endpoints, CLI vault commands

---

### Milestone 4: Infrastructure — Postgres (3 days)

**Deliverables:**
- SQL migrations (`golang-migrate`): all 8 tables from PRD Section 9
- `sqlc`-generated query layer from `.sql` query files
- `internal/infrastructure/postgres/`: VaultRepository, UserRepository, OrgRepository, APIKeyRepository, SessionStore (wrap sqlc output, map to domain entities)
- `pgx/v5` connection pool with health check
- DB model structs + mapping to domain entities

**Acceptance Criteria:**
- 80%+ coverage via testcontainers (real Postgres)
- All migrations up AND down successfully
- Repository tests verify SQL queries return correct data
- No SQL injection surface (all queries parameterized)

**Unblocks:** End-to-end API flows

**Risk:** Schema drift between PRD and migrations. Mitigation: schema is generated from a single `schema.sql` file committed alongside migrations.

---

### Milestone 5: API Layer (3 days)

**Deliverables:**
- `internal/presenters/api/`: Router (`chi`), middleware (auth, rate_limit via `ulule/limiter`, cors, logging), all handlers from PRD Section 10
- Request/response DTOs + `go-playground/validator` struct tags
- Error handling middleware (maps domain errors → HTTP status)
- OpenAPI spec (`swaggo/swag` from handler annotations)
- Static frontend asset serving (`/` → React SPA)

**Acceptance Criteria:**
- 80%+ handler coverage (httptest)
- All endpoints from PRD Section 10 implemented
- Rate limiting blocks at 60 req/min
- Invalid JWT returns 401, expired returns 401 with `TOKEN_EXPIRED` error code
- CORS configured per environment

**Unblocks:** Frontend and extension development

---

### Milestone 6: Shared Crypto Module (3 days)

**Deliverables:**
- TypeScript crypto module in `web/src/shared/crypto/` (reusable by web + extension)
- Argon2id via `hash-wasm` (WASM)
- AES-GCM, RSA-OAEP, HKDF via native Web Crypto API
- Key derivation flows matching backend expectations
- Typed `TypedArray` zeroing on lock (best-effort memory scrubbing)
- `zod` schemas for encrypted payload validation

**Acceptance Criteria:**
- Interop tests: client encrypts, backend test decrypts using same params
- Performance: Argon2id < 2s on modern laptop
- All crypto calls go through typed helpers (no raw WebCrypto calls in features)

**Unblocks:** Web UI, browser extension

**Risk:** Argon2id in browser is WASM-based and slower than native. Mitigation: benchmark early, tune params if needed.

---

### Milestone 7: Web UI (6 days)

**Deliverables:**
- React 19 + Vite 6 + TanStack Router scaffold
- TanStack Query for API state, Zustand for auth + vault key state
- `react-hook-form` + `zod` for all forms
- shadcn/ui components + Tailwind CSS, `lucide-react` icons
- `openapi-fetch` typed client generated from backend OpenAPI spec
- Auth pages: login, register, 2FA setup, password change
- Vault pages: list, item editor (all 7 types), folder tree, trash view
- Password generator, custom fields editor, password history viewer
- Settings: profile, sessions, auto-lock config, clipboard clear config
- Admin panel: user management, org management
- Clipboard auto-clear, vault auto-lock, reprompt flow
- Dark/light mode, responsive (tablet)

**Acceptance Criteria:**
- All vault features accessible via UI
- Vitest component tests for critical flows (> 70% coverage)
- Lighthouse: performance > 90, accessibility > 95
- No secrets ever in URL params, localStorage, sessionStorage, or IndexedDB

**Key persistence strategy (M9 — LOCKED):**
- `stretchedKey`, decrypted RSA private key, Ed25519 identity private key, and vault keys live ONLY inside a dedicated **Web Worker** scope. No key ever crosses into the main thread as a raw `CryptoKey` export.
- Main thread communicates via `postMessage` with an opaque job interface (`{op: "decrypt", vaultId, itemId}` → `{plaintext}`); the Worker holds the keys and does all crypto.
- On `VAULTCTL_VAULT_LOCK_MINUTES` timeout OR tab close OR explicit `lock()`, Worker terminates itself and zeroes its `Uint8Array`s first.
- Reload UX is accepted: a reload kills the Worker, user must re-enter master password. No "remember me" checkbox in v1.
- Extension uses the same pattern inside its service worker scope (M11).

**Recovery Kit UX (M12):**
- Registration flow: show Recovery Kit page with printable PDF + QR, require "I saved it" checkbox before completing.
- Settings → Recovery Kit: regenerate (invalidates old), re-download. Guarded by step-up auth.

**Safety-number UI (C1):**
- Per-user page shows the 60-char safety number derived from their `identity_public_key`. Prompts to verify out-of-band on first share with a new peer.
- TOFU mismatch on login → modal "This user's identity key has changed. If unexpected, DO NOT share with them." with Accept/Reject.

**Unblocks:** User acceptance testing

**Risk:** Scope creep in UI polish. Mitigation: timebox, use shadcn/ui defaults.

---

### Milestone 8: Multi-User & Sharing (3 days)

**Deliverables:**
- Organization CRUD (create, invite, manage members)
- **Invite flow (M11):** token = 256 bits random; `invites` table stores `hmac_sha256(VAULTCTL_SERVER_PEPPER, token)`, `expires_at` (24–72h TTL, configurable), `used_at`, `revoked_at`; single-use; per-IP rate limit on redemption endpoint; auto-revoked on inviter removal OR role change of the inviting user
- Shared vault creation and membership
- **Unconditional vault rekey (C2):** on ANY member removal or role downgrade, client performs the full re-encryption flow from §4.4: new `vaultKey`, re-encrypt every `vault_items.encrypted_data/name` and `folders.encrypted_name`, re-wrap for every remaining member with fresh `wrap_signature`
- **Signed public-key fetch (C1):** `GET /orgs/:id/members/:userId/pubkey` returns `{publicKey, publicKeySignature, identityPublicKey}`; clients verify before wrapping
- **Sender-signed wrapped key (H1):** every `vault_members` insert requires an Ed25519 signature over `vault_id ∥ user_id ∥ encrypted_vault_key` by the sender's identity key
- Role-based access control (owner, admin, member)

**Acceptance Criteria:**
- Sharing a vault with user B means B can decrypt items after they log in AND after wrap-signature verification succeeds
- Removing ANY member triggers vault rekey + item re-encryption (C2) — no "read-only bypass" path
- Role-downgrade (e.g., admin → read-only) triggers rekey (the downgraded user's cached key is still valid otherwise)
- Client rejects a pubkey fetch where `publicKeySignature` doesn't verify under `identityPublicKey` (C1)
- Client rejects a `vault_members` row where `wrap_signature` doesn't verify under sender's pinned identity key (H1)
- Invite token redemption is single-use (second attempt → 410 Gone) and rate-limited per IP (M11)
- Role changes take effect on next request (no stale JWT claims)
- Integration test: admin removal triggers rekey; removed admin's stored vaultKey fails to decrypt new items written after removal

**Unblocks:** Team usage

---

### Milestone 9: Import / Export (3 days)

**Deliverables:**
- Parsers for: Bitwarden (JSON + CSV), 1Password (1PUX + CSV), LastPass (CSV), KeePass (XML)
- Export: encrypted JSON (native format), unencrypted CSV with warning
- Import runs client-side — file never uploaded unencrypted
- Mapping to all 7 item types (new types enrich existing imports where applicable)
- **Envelope integrity (M6):** the encrypted JSON export wraps all item ciphertexts with a file-level MAC. Format:
  ```
  {
    "version": 1,
    "created_at": "...",
    "user_id": "...",
    "items": [ {id, encrypted_data, encrypted_name, item_type, folder_id}, … ],
    "envelope_mac": Ed25519-Sign(identityPrivKey, sha256(canonical_json(version ∥ created_at ∥ user_id ∥ items)))
  }
  ```
  Importers verify `envelope_mac` against the user's `identityPublicKey` before ingesting any item. A tampered or truncated file fails fast.

**Acceptance Criteria:**
- Golden-file tests for each import format with sample data
- Round-trip: export → import produces identical items AND envelope_mac verifies
- Tampering test: mutate one byte of one item's ciphertext → import fails with envelope_mac mismatch (M6)
- Import errors are per-item (one bad item doesn't fail the batch)

**Unblocks:** User migration from other vaults

---

### Milestone 10: CLI (3 days)

**Deliverables:**
- All commands from PRD Section 12 using `spf13/cobra`
- Interactive prompts via `charmbracelet/huh` (master password, confirmations)
- OS keychain session storage via `zalando/go-keyring`
- Table output via `olekukonko/tablewriter`, JSON output via stdlib
- API key auth for CI/CD (`VAULTCTL_API_KEY` env var)

**Acceptance Criteria:**
- 70%+ coverage
- All commands produce documented exit codes
- `vaultctl get <name> --field password` prints only the password (script-friendly)
- API key auth works without interactive prompt

**Unblocks:** CI/CD integration, developer daily use

---

### Milestone 11: Browser Extension (6 days)

**Deliverables:**
- Manifest V3 extension built with **WXT** (Vite-based)
- Popup UI (React, shares components + crypto module with web/)
- Content scripts: auto-fill, save on submit, TOTP copy
- Background service worker: API calls, auto-lock
- WebAuthn relay for passkey registration + authentication (intercepts `navigator.credentials`)
- Configurable server URL, independent auto-lock timeout
- Dual builds: Chrome (Web Store) + Firefox (AMO)

**Acceptance Criteria:**
- Auto-fill works on top 20 popular sites (test matrix)
- Passkey relay works on webauthn.io test page
- Extension reports correctly in `chrome://extensions/` (no warnings)
- Publishes to Chrome Web Store + Firefox Add-ons (manual)

**Unblocks:** Mainstream browser usage

**Risk:** Manifest V3 restrictions on service workers. Mitigation: design background script to be event-driven from day 1.

---

### Milestone 12: Backup / Restore (2 days)

**Deliverables:**
- `vaultctl backup` CLI command
- Backup file format: PostgreSQL custom dump + metadata + checksum
- Restore procedure (documented, tested)
- CI job: restore last night's backup, verify vault integrity
- `VAULTCTL_BACKUP_RETENTION_DAYS` cleanup job
- **Key separation guard (M2):** `vaultctl backup` refuses to write if `VAULTCTL_BACKUP_DIR` resolves to a directory containing ANY `.env*` file, or if the env-file path is a subpath of `VAULTCTL_BACKUP_DIR`. Emits a loud remediation message.
- **Docs — key separation loudly:** backup documentation (`docs/operations/backup.md`) has a top-banner "DO NOT back up your server keys with the database" with example remote-storage split (B2/S3 bucket A for DB, SOPS-in-git for `.env`).

**Acceptance Criteria:**
- Backup → restore produces identical DB state (row-level diff)
- Backup files contain no plaintext secrets (grep test)
- Backup refuses to run when `.env` sits inside `VAULTCTL_BACKUP_DIR` (M2 test)
- Restore docs walk through full procedure in < 5 minutes

**Unblocks:** Production-ready self-hosting

---

### Milestone 13: Security Hardening (3 days)

**Deliverables:**
- Rate limiting (chi middleware + Redis/in-memory counter)
- Audit logging on all state changes
- CSP headers, HSTS, SameSite cookies
- Session management (list, revoke, device fingerprinting)
- Reprompt flow enforcement in all clients
- gosec + govulncheck clean

**Acceptance Criteria:**
- Security tests from PRD Section 14.4 all pass
- Penetration test checklist (OWASP top 10) reviewed
- No high/critical vulns from govulncheck

**Unblocks:** Production deployment

---

### Milestone 14: Release & Docs (2 days)

**Deliverables:**
- goreleaser config for standalone binaries (linux, darwin, windows)
- release-please workflow for automated versioning
- Multi-arch Docker images (amd64 + arm64) to GHCR + Docker Hub
- VitePress docs site (installation, config, usage, security model)
- Public status page (if cloud roadmap active)
- **Supply-chain integrity (H13) — NON-NEGOTIABLE for a credential vault:**
  - cosign-sign every artifact (binary + container image + checksums) with a keyless (Sigstore) signature tied to the GitHub Actions OIDC identity
  - Publish SLSA L3 provenance attestation for every release (via `slsa-framework/slsa-github-generator`)
  - Attach CycloneDX + SPDX SBOMs for container image and Go binary (via `anchore/sbom-action`)
  - Publish public cosign verification instructions in `docs/security/verifying-releases.md` with copy-pastable `cosign verify` / `cosign verify-attestation` commands
  - Install docs prepend verification steps before any `docker pull`

**Acceptance Criteria:**
- `docker pull ghcr.io/vineethkrishnan/vaultctl:v1.0.0` works on arm64 + amd64
- `cosign verify ghcr.io/vineethkrishnan/vaultctl:v1.0.0 --certificate-identity-regexp '^https://github.com/vineethkrishnan/vaultctl' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'` succeeds on every published image (H13)
- SLSA provenance attestation verifies for every binary and image artifact
- SBOM is downloadable from the release page
- Docs site covers: deploy, upgrade, backup, **verify release signature**, import, extension install
- Release notes auto-generated from conventional commits

**Unblocks:** Public launch

---

### Milestone 15: Integration & E2E Testing (3 days)

**Deliverables:**
- End-to-end tests: Playwright covering login → create item → lock → unlock → share
- Load testing: k6 or Vegeta simulating 100 concurrent users
- Security testing: OWASP ZAP scan against running instance
- Backup/restore integrity test in CI

**Acceptance Criteria:**
- E2E suite runs in < 10 minutes in CI
- Load test: p95 < 200ms at 100 RPS
- No high-severity ZAP findings

**Unblocks:** v1.0 release

---

## 9. Critical Path

```
M0 (Scaffold) ──→ M1 (Domain) ──→ M2 (Auth) ──→ M3 (Vault) ──→ M4 (Postgres) ──→ M5 (API)
                                      │                                              │
                                      ├────────────→ M6 (Crypto JS) ────────────────┤
                                      │                                              ▼
                                      │                                         ┌─ M7 (Web UI)
                                      │                                         ├─ M10 (CLI)
                                      │                                         └─ M11 (Extension)
                                      │                                              │
                                      │                                              ▼
                                      │                                         M8 (Multi-User)
                                      │                                              │
                                      │                                              ▼
                                      │                                         M9 (Import/Export)
                                      │                                              │
                                      │                                              ▼
                                      │                                         M12 (Backup)
                                      │                                              │
                                      │                                              ▼
                                      │                                         M13 (Hardening)
                                      │                                              │
                                      │                                              ▼
                                      │                                         M14 (Release)
                                      │                                              │
                                      │                                              ▼
                                      │                                         M15 (E2E)
```

**Critical path:** M0 → M1 → M2 → M3 → M4 → M5 → (M7 || M11) → M13 → M14 → M15

**Parallelization opportunities:**
- M6 (Crypto JS) can start after M2 is done
- M7, M10, M11 can be developed in parallel after M5 + M6
- M9 (Import/Export) can start in parallel with M7 once M3 is complete

**Total duration:** ~47 working days (single engineer, sequential). With 2 engineers parallelizing M7/M11, can reduce to ~35 days.

---

## 10. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Argon2id too slow in browser WASM | Medium | High | Benchmark in M6, tune params if needed, consider libsodium.js as fallback |
| Browser extension Manifest V3 restrictions | Medium | Medium | Design event-driven from day 1, prototype passkey relay early |
| Cryptographic implementation bug | Low | Critical | Use standard libraries only, external security audit before v1.0 |
| Database schema changes mid-project | Medium | Medium | Lock schema after M4, require migration for any change |
| Vault sharing key rotation bug | Medium | High | Dedicated integration tests, property-based tests for re-encryption |
| TLS configuration too complex for users | High | Medium | Caddy automation, clear docs, simple.yml variant for BYO proxy |
| Import format breakage (3rd party changes) | Medium | Low | Golden-file tests, CI check against sample exports |
| Cloud offering scope creep into v1 | Medium | High | Hard gate: no `tenant_id` in v1 schema, no billing code in v1 |

---

## 11. Post-v1 Architecture Evolution

### 11.1 Additions for Cloud Offering

- **Multi-tenancy migration:** Add `tenant_id` to `users`, `vaults`, `organizations`, `audit_logs`. Enforce via Postgres row-level security. Every RLS policy MUST include BOTH `USING` and `WITH CHECK` — forgetting `WITH CHECK` is the most common tenant-isolation escape hatch (M10). Template:

  ```sql
  -- M10 required template — every tenant-scoped table gets this
  ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
  ALTER TABLE vaults FORCE ROW LEVEL SECURITY;

  CREATE POLICY vaults_tenant_isolation ON vaults
    USING      (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  ```

  CI gate: integration test that a connection with `SET app.tenant_id = 'A'` cannot `INSERT`, `UPDATE`, or `SELECT` rows with `tenant_id = 'B'` across every RLS-protected table. Test asserts both `USING` (read isolation) and `WITH CHECK` (write isolation).
- **Billing module:** New `infrastructure/billing/stripe.go` adapter, `application/billing/` use cases (subscribe, cancel, upgrade).
- **Tenant admin:** New `presenters/api/admin/` handlers, gated by `VAULTCTL_HOSTED_MODE`.
- **Usage metering:** Events table tracking seat count, storage, API calls per tenant.

### 11.2 Additions for Enterprise

- SSO adapter (SAML, OIDC) as new `infrastructure/sso/` implementing a `SSO` port
- LDAP directory sync adapter
- Advanced audit log export (SIEM integration)

### 11.3 Additions for Mobile

- Mobile API (same backend, iOS/Android clients)
- Offline mode with encrypted local cache
- Biometric unlock (Face ID, fingerprint) bound to master key

None of these require domain or application layer changes — all plug in through new infrastructure adapters.

---

## 12. Tech Stack Decisions

### 12.1 Locked Decisions (v1)

These decisions are final for v1. Changing them requires amending both this document and the PRD.

#### Backend

| Concern | Pick | Rejected Alternatives | Rationale |
|---------|------|----------------------|-----------|
| **Language** | Go 1.23+ | Rust, TypeScript/Bun, Python | Single binary, strong stdlib crypto, low contributor barrier (explicit anti-Rust stance from Vaultwarden lesson) |
| **HTTP router** | `chi` | gin, echo, fiber | stdlib-compatible, no magic, `http.Handler` interface |
| **DB driver** | `jackc/pgx/v5` | `lib/pq`, `database/sql` + pq | Native Postgres, faster, built-in pooling, better error types |
| **SQL layer** | `sqlc` | GORM, ent, raw pgx | Type-safe generated Go from `.sql` files. SQL is auditable/reviewable (critical for security app). No runtime ORM overhead. GORM hides too much. |
| **Migrations** | `golang-migrate` | `goose`, `atlas` | Mature, up/down pairs, works in CI |
| **Config** | `caarlos0/env/v10` | viper, envconfig | Struct-tag env parsing. No YAML/TOML complexity — we have env vars only. |
| **Logging** | `log/slog` (stdlib) | zap, zerolog | Structured, stdlib, enough for v1 |
| **Secure memory** | `awnumar/memguard` | manual `runtime.GC()` tricks | Go's GC cannot guarantee memory zeroing. Memguard locks pages, zeros on free. Non-negotiable for a vault. |
| **JWT** | `golang-jwt/jwt/v5` | lestrrat-go/jwx, custom | De-facto Go JWT lib, v5 is actively maintained |
| **TOTP** | `pquerna/otp` | custom, `xlzd/gotp` | Used in production by many projects, supports QR generation |
| **Validation** | `go-playground/validator/v10` | manual, ozzo-validation | Struct-tag idiom, integrates with handlers |
| **Rate limiting** | `ulule/limiter/v3` | `didip/tollbooth`, custom | In-memory adapter for v1, Redis adapter ready for cloud |
| **Email** | `wneessen/go-mail` | `go-mail/mail` (unmaintained), stdlib net/smtp | Modern, actively maintained SMTP client |
| **Testing** | stdlib `testing` + `testify` + `testcontainers-go` | ginkgo, goblin | Boring, standard Go idiom |

#### Frontend

| Concern | Pick | Rejected Alternatives | Rationale |
|---------|------|----------------------|-----------|
| **Framework** | React 19 | Vue, Svelte, Solid | Largest ecosystem, shadcn/ui is React-first |
| **Build tool** | Vite 6 | Next.js, Webpack, Parcel | SPA is right fit (no SEO need, heavy client crypto). Vite is fast, static output. |
| **Router** | TanStack Router | React Router v7, Wouter | Type-safe routes, file-based, first-class nested layouts |
| **Data fetching** | TanStack Query v5 | SWR, RTK Query, raw fetch | Industry standard, cache + invalidation, optimistic updates |
| **State mgmt** | Zustand | Redux, Jotai, React Context only | Minimal boilerplate, exactly enough for auth + vault key state |
| **Forms** | `react-hook-form` | Formik, TanStack Form | Best perf, cleanest API for conditional fields (item-type switching) |
| **Validation** | `zod` | yup, valibot | Best TS inference, shared schemas with API layer |
| **UI components** | shadcn/ui + Tailwind CSS | MUI, Chakra, Mantine | Copy-paste, no dep lock-in, customizable, modern aesthetic |
| **Icons** | `lucide-react` | react-icons, heroicons | Bundled with shadcn/ui |
| **API client** | `openapi-fetch` + generated types | axios, raw fetch, orval | Type-safe end-to-end from OpenAPI spec |
| **Argon2id (WASM)** | `hash-wasm` | argon2-browser, libsodium.js | Smallest bundle (~40KB), fastest WASM Argon2id |
| **Testing (unit)** | Vitest + React Testing Library | Jest | Vite-native, faster |
| **Testing (E2E)** | Playwright | Cypress, Puppeteer | Multi-browser, better async handling |

#### Browser Extension

| Concern | Pick | Rejected Alternatives | Rationale |
|---------|------|----------------------|-----------|
| **Framework** | WXT | Plasmo, raw Manifest V3, CRXJS | Vite-based (same toolchain as web/), MV3-first, hot reload, least friction |
| **UI framework** | React (shared with web/) | Preact, Svelte | Share components with web UI |

#### CLI

| Concern | Pick | Rejected Alternatives | Rationale |
|---------|------|----------------------|-----------|
| **Framework** | `spf13/cobra` | urfave/cli, stdlib flag | De-facto Go CLI standard (kubectl, gh, docker) |
| **Prompts** | `charmbracelet/huh` | survey, promptui | Modern, pretty, well-maintained |
| **Tables** | `olekukonko/tablewriter` | custom | Simple, widely used |
| **OS keychain** | `zalando/go-keyring` | custom file-based | Uses OS-native secret storage (macOS Keychain, libsecret, Win Cred Manager) |

#### Infrastructure

| Concern | Pick | Rejected Alternatives | Rationale |
|---------|------|----------------------|-----------|
| **Reverse proxy** | Caddy 2 | nginx, Traefik, none | Automatic HTTPS via Let's Encrypt, simplest config |
| **Database** | PostgreSQL 16 | MySQL, SQLite, multi-DB | One DB, well-supported, row-level security ready for multi-tenant |
| **Backup** | `pg_dump` (shell out) | custom Go implementation | Don't reinvent — `pg_dump` is battle-tested |
| **Rate limit storage (v1)** | In-memory | Redis | Single-instance self-hosted; Redis only when scaling |
| **CI/CD** | GitHub Actions | CircleCI, GitLab CI | Free for public repos, good marketplace |
| **Release** | goreleaser + release-please | manual, semantic-release | Automates binaries + versioning from conventional commits |
| **Docs** | VitePress | Docusaurus, mkdocs, Nextra | Vue-based but framework-agnostic content, fast, looks great |

### 12.2 Remaining Open Decisions

| # | Decision | Options | Owner | Due |
|---|----------|---------|-------|-----|
| 1 | Rate limit storage for cloud tier | Redis, Valkey, DragonflyDB | Eng | Post-v1 |
| 2 | Cloud hosting platform | Fly.io, Vercel + Neon, AWS ECS, Hetzner + self-managed | PM | Post-v1 |
| 3 | Payment processor (cloud) | Stripe, Paddle, Lemon Squeezy | PM | Post-v1 |
| 4 | Observability stack (cloud) | OTel + Grafana Cloud, Sentry, Datadog | Eng | Post-v1 |
| 5 | Session storage strategy | JWT-only (current), server-side sessions, hybrid | Eng | Reassess during M13 |

---

## 13. Security Review Responses

This section is the traceability matrix for `docs/initial/security-review.md` (v1.0, Apr 5 2026). Every finding is addressed here with a pointer to the resolved location in this doc and the PRD. All Critical and High findings must be green before M0 starts coding.

### 13.1 Critical — resolved in design (pre-M0 gate)

| # | Finding | Resolution (this doc) | Resolution (PRD) |
|---|---------|-----------------------|------------------|
| C1 | Server-controlled public keys | §4.1 identity keypair; §4.2 pubkey verification on login; §4.4 safety-number UI; §5.2 `identity_public_key` + `public_key_signature` columns | §9.1 `identity_public_key`, `encrypted_identity_private_key`, `public_key_signature` columns; §5.3 safety-number UX; §10.4 pubkey endpoint returns signed bundle |
| C2 | Read-only removal does not rekey | §4.4 unconditional rekey sequence; M8 acceptance criteria | §5.3 hard rule "ANY removal triggers rekey"; §10.4 `DELETE member` and `PUT role` both trigger rekey |
| C3 | Refresh tokens stored raw | §5.2 `refresh_token_hash` row; §4.2 login flow now HMAC'd | §9.6 `refresh_token_hash BYTEA`; §11.1 `VAULTCTL_SERVER_PEPPER` env var |
| C4 | authHash redaction | §4.2 redaction call-out; §6.5 redaction middleware spec; M13 | §11.1 `VAULTCTL_LOG_REDACT_FIELDS`; §7.4 threat-model row; §14.4 CI log-grep test |
| C5 | Ciphertext versioning | §5.2 `alg_id` column for every blob; §4.1 all `encXxx` carry `v1|…` header | §9.9 new subsection: wire format + alg_id enum + migration contract |

### 13.2 High — resolved in design

| # | Finding | Resolution |
|---|---------|------------|
| H1 | Unauthenticated RSA-OAEP wrap | §4.4 `wrap_signature` on every share; §5.2 `vault_members.wrap_signature` field; PRD §9.2; M8 test |
| H2 | Prelogin enumeration | §4.2 fake-salt branch; PRD §10.1 + §7.4 + §14.4 timing test; `VAULTCTL_ENUMERATION_PEPPER` env |
| H3 | IP-only rate limit | §6.3 per-IP + per-email + global circuit breaker; `VAULTCTL_AUTH_RATE_LIMIT_PER_EMAIL`, `VAULTCTL_TRUSTED_PROXIES`; v1 DB-backed counters |
| H4 | Plaintext password hint | §5.2 `encrypted_password_hint` under `VAULTCTL_DATA_ENCRYPTION_KEY`; PRD §9.1 |
| H5 | Undefined server encryption key | PRD §11.1 `VAULTCTL_DATA_ENCRYPTION_KEY` + rotation; §5.2 mapping; §17.4 separation rule (M2) |
| H6 | TOTP replay | PRD §5.5 + §9.1 `users.totp_last_counter`; §14.4 replay test |
| H7 | SHA-256 API key hash | §5.2 HMAC-SHA256 pepper; PRD §9.7 `BYTEA` + `VAULTCTL_SERVER_PEPPER` |
| H8 | Static JWT secret | §6.3 dual-key `_CURRENT`/`_NEXT` + `kid`; PRD §11.1; rotation doc pointer |
| H9 | AES-GCM nonce | §5.2 nonce policy; PRD §9.9 + §14.4 random-nonce test; 2^28 rotation trigger |
| H10 | No step-up auth | §6.3 step-up list; PRD §10.1 endpoints + `POST /auth/step-up` + `VAULTCTL_STEP_UP_MAX_AGE` |
| H11 | Cross-vault IDOR | M3 AC enforces `user ∈ vault_members` AND `item.vault_id == :vaultId`; PRD §14.4 test |
| H12 | DB_SSL_MODE=disable default | PRD §11.1 default flipped to `require`; Docker Compose is sole exception |
| H13 | No supply-chain integrity | M14 cosign + SLSA L3 + SBOM requirement; install docs must show `cosign verify` |

### 13.3 Medium — resolved or scheduled

| # | Finding | Status | Resolution |
|---|---------|--------|------------|
| M1 | Audit log IP retention | Resolved | §5.3 tiered retention (30d raw / 365d anonymised); `VAULTCTL_LOG_IP_PRECISION` |
| M2 | Backup/key co-location | Resolved | M12 backup refuses if `.env` inside `BACKUP_DIR`; PRD §17.4 hard rules |
| M3 | `ON DELETE CASCADE` on `vault_members` | Resolved | PRD §9.2 `removed_at` soft-delete; `ON DELETE RESTRICT` FK |
| M4 | Personal vault RSA overhead | Resolved | §4.1 uses `alg_id=0x03` AES-KW for personal vaults; §5.2 mapping |
| M5 | `encrypted_name` length leak | Resolved | PRD §9.9 32-byte PKCS#7 padding rule; §5.2 note |
| M6 | No export envelope MAC | Resolved | M9 `envelope_mac` format + tamper test |
| M7 | CSRF story ambiguous | Resolved | PRD §7.4 — committed to header-only `Authorization: Bearer`; no cookies |
| M8 | CSP not specified | Resolved | §6.4 exact CSP committed + companion headers |
| M9 | Client key persistence | Resolved | M7 Web Worker strategy locked; reload UX accepted |
| M10 | RLS migration landmine | Resolved | §11.1 RLS template requires `USING` + `WITH CHECK`; CI tenant-isolation test |
| M11 | Invite tokens under-specified | Resolved | M8 full spec: 256-bit, single-use, 24–72h, HMAC, rate-limited |
| M12 | No user-recovery story | Resolved | PRD §5.14 Recovery Kit; M7 UX; `/auth/recovery/*` endpoints |

### 13.4 Informational — tracked for v1.0 / post-v1

| Topic | Status | Notes |
|-------|--------|-------|
| RSA-2048 legacy after 2030 | Tracked | C5 versioning enables X25519/HPKE migration without rewrite |
| OPAQUE / SRP-6a | Tracked | Future replacement for authHash-on-wire (post-v1) |
| Enum types for `role` | Tracked | Convert `VARCHAR(50)` → Postgres ENUM in M4 migrations |
| Single-node cron | Tracked | Self-hosted v1 only; cloud needs leader election |
| External crypto review | Required for v1.0 | Definition of Done gate |
| Admin bootstrap | Resolved | `vaultctl admin init` (PRD §5.3) |
| IP logging toggle | Resolved | `VAULTCTL_LOG_IP_PRECISION` (M1) |

### 13.5 Pre-M0 Gate Checklist

All boxes MUST be checked before M0 begins implementation:

- [x] C1 — Identity key signing landed in §4.1, §4.4, §5.2, PRD §9.1, §10.4
- [x] C2 — Unconditional rekey rule landed in §4.4, M8, PRD §5.3
- [x] C3 — `refresh_token_hash` landed in §5.2, PRD §9.6, §11.1
- [x] C4 — authHash redaction landed in §6.5, PRD §11.1, §14.4
- [x] C5 — Ciphertext version/alg header landed in PRD §9.9, §5.2
- [x] H2 — Prelogin fake salt landed in §4.2, PRD §10.1, §14.4
- [x] H5 — `VAULTCTL_DATA_ENCRYPTION_KEY` landed in PRD §11.1, §17.4, §5.2
- [x] H8 — JWT dual-key rotation landed in PRD §11.1, §6.3
- [x] H12 — `DB_SSL_MODE=require` default in PRD §11.1
- [x] H13 — cosign + SLSA L3 in M14
- [x] M9 — Web Worker key persistence locked in M7
- [x] M12 — Recovery Kit in PRD §5.14, M7, §10.1

---

## 14. Definition of Done (v1.0)

- [ ] All milestones M0-M15 complete
- [ ] Test coverage ≥ 85% global
- [ ] All security tests from PRD Section 14.4 pass
- [ ] govulncheck + gosec clean (no high/critical)
- [ ] External security review completed
- [ ] All Critical + High findings in §13 green; log-redaction test and cross-vault IDOR test green
- [ ] Release artifacts verified via `cosign verify` + SLSA L3 attestation (H13)
- [ ] `VAULTCTL_DATA_ENCRYPTION_KEY` rotation procedure dry-run completed on staging (H5)
- [ ] Docker image < 50MB
- [ ] `docker compose up` from fresh clone → working UI in < 2 minutes
- [ ] Docs site live with install, usage, security model
- [ ] Extension published to Chrome Web Store + Firefox Add-ons
- [ ] Binaries published for linux/darwin/windows (amd64 + arm64)
- [ ] AGPL-3.0 license file in place
- [ ] SECURITY.md with vulnerability disclosure policy
- [ ] 10+ real users successfully self-hosting (beta)
