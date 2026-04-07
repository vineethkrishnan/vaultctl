# Security Review: vaultctl Architecture

**Version:** 1.0
**Date:** April 5, 2026
**Status:** Draft — pre-implementation review
**Reviews:** `prd.md` v1.0, `architecture.md` v1.0

---

## 1. Purpose

This document is a security audit of the vaultctl architecture as specified in `prd.md` and `architecture.md`. It was produced **before any code was written**, so every finding is a design-level change that should land in the specs before Milestone 0 begins.

Findings are grouped by severity. Each has a concrete fix and a pointer to the doc location that needs updating.

---

## 2. Severity Definitions

| Level | Meaning | Action |
|-------|---------|--------|
| **Critical** | Breaks a core security property (zero-knowledge, auth integrity, tenant isolation) | Must fix in design before M0 |
| **High** | Meaningfully weakens the threat model or creates a realistic attack path | Fix in design before the relevant milestone |
| **Medium** | Hardening gap, clear best-practice violation, or under-specified area | Address during the owning milestone |
| **Informational** | Future-proofing, documentation clarity, or long-horizon decision | Track, revisit before v1.0 release |

---

## 3. Top 5 — Must Fix Before Code

1. **C1** — Identity-key-signed public keys (otherwise "zero-knowledge" breaks under a malicious server)
2. **C2** — Rekey vault on ANY member removal, not just write-access removals
3. **C3** — Hash refresh tokens at rest
4. **C5** — Version byte on every ciphertext blob
5. **H2** — Prelogin endpoint must not leak user existence

---

## 4. Critical Findings

### C1. Server-controlled public keys enable trivial MITM on sharing

**Where:** `prd.md` §5.9 (users table), `architecture.md` §4.4 (sharing flow, line 234), §5.2 (encryption field map, line 295).

`users.public_key TEXT` is stored plaintext and served on request (`GET /orgs/:id/members/:userId/pubkey`). A malicious or compromised server can substitute its own public key and decrypt every vault share made to that user. The zero-knowledge claim breaks the moment an attacker controls the server.

**Fix:**
- Add an Ed25519 identity keypair per user, generated client-side during registration.
- The identity private key is encrypted with the user's `stretchedKey` and stored server-side (same pattern as RSA private key).
- The RSA public key is signed by the identity key; clients verify the signature before using the pubkey for wrapping.
- Clients pin identity keys TOFU-style and expose a "safety number" fingerprint that users can verify out-of-band.

**Cost:** +1 keypair per user, +1 signature field on `users.public_key`, pubkey-fetch endpoint now returns `{publicKey, publicKeySignature, identityPublicKey}`.

---

### C2. Read-only member removal does not rekey the vault

**Where:** `architecture.md` §M8 (line 606): "Removing a member revokes their access (vault key rotated if they had write access)".

Conditional rotation is wrong. A removed read-only member still holds the vault key in client memory, extension cache, CLI keyring, or an offline export. They can decrypt items they already saw and any new items they exfiltrated later, because the vault key does not change.

**Fix:**
- Rotate `vaultKey` unconditionally on **any** member removal or role downgrade.
- Re-encrypt every `vault_items.encrypted_data`, `vault_items.encrypted_name`, and `folders.encrypted_name` under the new key.
- Re-wrap the new `vaultKey` for each remaining member's RSA public key.

**Cost:** O(n) re-encryption per removal, client-driven. Document this cost and add progress UI.

---

### C3. Refresh tokens stored raw in Postgres

**Where:** `prd.md` §9.6 (sessions table, line 651): `refresh_token VARCHAR(512) UNIQUE NOT NULL`.

A Postgres dump yields directly-usable 7-day session tokens for every active user. The "MITM/session hijack" mitigation in the threat model (`prd.md` §7.4) fails under a DB compromise.

**Fix:**
- Store `sha256(refresh_token)` or (better) `hmac_sha256(server_pepper, refresh_token)`.
- Lookup by hash at refresh time.
- API keys already follow this pattern (`api_keys.key_hash`, line 668) — apply it here.

**Cost:** +1 pepper env var, +1 HMAC per refresh call.

---

### C4. Auth hash on the wire = a credential that must never be logged

**Where:** `architecture.md` §4.2 (line 185-187): `POST /auth/login {email, authHash}`.

The client-derived `authHash` is a long-term credential. If ever logged — by a body-logging middleware, a reverse-proxy access log with request bodies, a debug dump, or observability tooling — an attacker can log in as the user. The server-side Argon2 re-hash protects the DB at rest but does nothing for wire/transit/logs.

**Fix:**
- Document an explicit redaction rule: `authHash` MUST be excluded from every access log, request log, and error trace.
- Enforce it in the logging middleware (tag the field, strip it).
- Document a trusted-proxy list (Caddy, nginx) with body-logging explicitly off for `/auth/*` routes.
- Add a security test (`prd.md` §14.4) asserting `authHash` never appears in log output.

**Future-proofing:** consider OPAQUE or SRP-6a for v2 to eliminate wire exposure of any password-equivalent material.

---

### C5. Ciphertext has no version/algorithm tag

**Where:** `prd.md` §9.1, §9.2, §9.3: `encrypted_data TEXT`, `encrypted_vault_key TEXT`, `encrypted_private_key TEXT`.

None of the ciphertext columns carry a version byte or algorithm identifier. When algorithm migration happens (RSA-2048 → X25519/HPKE, AES-GCM → XChaCha20-Poly1305, Argon2id param bumps), there is no way to distinguish old vs new blobs at runtime. The migration becomes a full-vault-rewrite operation behind feature flags, which is expensive and error-prone.

**Fix:**
- Prefix every ciphertext blob with a compact header: `v1|alg_id|nonce|ct|tag` (1 byte version + 1 byte alg_id = 2 bytes overhead).
- Enumerate allowed `alg_id` values in a committed constants file shared by backend and crypto module.
- Document the migration contract: clients must accept multiple versions on read; new writes always use the latest.

**Cost:** 2 bytes per blob. Benefit: safe algorithm evolution without downtime.

---

## 5. High Findings

### H1. RSA-OAEP wrapping has no sender authentication

**Where:** `architecture.md` §4.4 (vault sharing, lines 239-247).

`encrypted_vault_key = RSA-OAEP(recipientPubKey, vaultKey)` carries no signature from the sender. A member with write access to `vault_members` can push a poisoned `encrypted_vault_key` for another recipient → key confusion, DoS, or (combined with C1) worse.

**Fix:** sign the wrapped key with the sender's Ed25519 identity key (from C1). Recipient verifies signature before unwrap.

---

### H2. Prelogin endpoint enables user enumeration

**Where:** `prd.md` §10.1 (`GET /auth/prelogin?email=...`), `architecture.md` §4.2 (line 174).

Returns salt + KDF params for known users; unknown emails presumably return 404. An attacker enumerates valid customer emails → spear-phishing target list. For a credential-vault product this is high-value intel.

**Fix:**
- For unknown emails, return a deterministic pseudo-salt: `HMAC(server_enumeration_pepper, normalized_email)`.
- Use the server's current default KDF params.
- Response shape and timing must be identical to the real-user case.

---

### H3. Rate limit is IP-only and too coarse for auth endpoints

**Where:** `architecture.md` §6.3 (line 358): "Rate limit 60 req/min per IP".

- Botnet / residential-proxy attackers bypass per-IP limits trivially.
- No per-account bucket on `/auth/login` → credential stuffing against a single email from many IPs is unthrottled before `locked_until` kicks in.
- CGNAT / IPv6 users share IPs → false positives.
- In-memory counter resets on server restart, wiping brute-force state.

**Fix:**
- Add a **per-email** bucket: 5 login attempts per email per 15 min (in addition to per-IP).
- Add a **global** auth-attempts circuit breaker (e.g., > 1000 failed logins/min → alert + temporary stricter limits).
- Document trusted-proxy config so `X-Forwarded-For` cannot be spoofed.
- Plan Redis-backed limiter for multi-pod future; persist failed-login counters in DB (already in schema, good — just use them).

---

### H4. Password hint stored plaintext server-side

**Where:** `prd.md` §9.1 (line 560): `password_hint VARCHAR(255)`.

Users write "dog's name + anniversary" in hints. On DB compromise, hints give attackers a huge head start on offline Argon2 cracking.

**Fix:** either
- Encrypt the hint with the server-side data-encryption key (same class as `totp_secret`), OR
- Remove the hint feature entirely and warn users at registration that zero-knowledge means no recovery, OR
- Warn prominently in the UI that hints are visible to the server operator and to anyone with DB access.

---

### H5. TOTP "server encryption key" is undefined

**Where:** `architecture.md` §5.2 (line 296): `users.totp_secret` uses AES-256-GCM with "Server encryption key".

The env-var template (`prd.md` §11.1, lines 794-845) does not define where this key lives, how it rotates, or how it's separated from the DB backup. Operators will either skip it or reuse `VAULTCTL_JWT_SECRET` — both bad.

**Fix:**
- Add `VAULTCTL_DATA_ENCRYPTION_KEY` to `.env.example` with generation instructions: `openssl rand -base64 32`.
- Document a rotation procedure (dual-key window: decrypt-with-either, re-encrypt-with-new, retire-old).
- Document that this key must **not** live in the same backup as the Postgres dump.

---

### H6. TOTP has no documented replay protection

**Where:** `prd.md` §5.5, `architecture.md` M2.

TOTP codes are valid for 30s. Without tracking last-used codes, a captured code is replayable inside the window.

**Fix:** track `users.last_totp_counter` (or per-user last-validated code hash + timestamp); reject codes ≤ last-used.

---

### H7. API key hash uses plain SHA-256

**Where:** `prd.md` §9.7 (line 668): `key_hash VARCHAR(512) NOT NULL -- SHA-256 hash`.

Safe only if keys have ≥256 bits of entropy. A peppered HMAC costs nothing and makes DB dumps worthless without the pepper.

**Fix:** `hmac_sha256(server_pepper, api_key)` instead of raw SHA-256. Same pepper as C3.

---

### H8. JWT signing uses a single static HS256 secret with no rotation plan

**Where:** `prd.md` §11.1 (line 812): `VAULTCTL_JWT_SECRET=change-me-to-random-64-chars`.

Compromise of env = forge any token. No `kid` header, no rotation procedure, no path to asymmetric signing for cloud mode.

**Fix:**
- Support dual keys (`current` + `next`) with `kid` header for zero-downtime rotation.
- Document the rotation procedure.
- For cloud mode, plan to switch to Ed25519 (asymmetric) so verification keys can be distributed without signing power.

---

### H9. AES-GCM nonce strategy under-specified

**Where:** `prd.md` §14.4 ("Ciphertext changes with each encryption (random nonce)"), `architecture.md` §5.2.

"Random nonce" is stated but not bounded. With random 96-bit nonces under a single `vaultKey`, birthday collision risk crosses acceptable thresholds past ~2^32 encryptions (~4 billion items — unlikely, but worth bounding).

**Fix:**
- Mandate 96-bit cryptographically random nonces (no counter-mode nonces).
- Define a vault-key rotation trigger: e.g., rotate after N items, or when item count crosses a threshold.
- Add a security test asserting that two back-to-back encryptions of identical plaintext produce different ciphertext.

---

### H10. No step-up auth on sensitive operations

**Where:** `prd.md` §10 (API spec).

These endpoints accept a plain 15-min JWT:
- `POST /auth/password/change`
- `POST /users/me/api-keys` (creates long-lived credential)
- `GET /export` (downloads entire vault)
- `POST /admin/backup`
- `DELETE /vaults/:id/trash/:id` (permanent purge)

A stolen access token → full vault export or persistent backdoor via API key.

**Fix:** require TOTP re-verification OR a fresh-auth reprompt (< 5 min old master-password proof) on all of the above.

---

### H11. IDOR surface on nested item URLs is not explicitly guarded

**Where:** `prd.md` §10.2 (`GET /vaults/:vaultId/items/:id`), `architecture.md` §M3 AC (line 498).

The doc says "user must be member of vault" but says nothing about "item must belong to THIS vault". Classic IDOR: attacker substitutes their own `vaultId` in the URL while passing a known victim `itemId` → bypasses the membership check and reads the victim's item.

**Fix:** every item handler must verify BOTH:
1. `user ∈ vault_members(vaultId)`
2. `item.vault_id == :vaultId`

Add a security test for cross-vault item access.

---

### H12. `VAULTCTL_DB_SSL_MODE=disable` as the default in `.env.example`

**Where:** `prd.md` §11.1 (line 809).

For a credential-vault template, this is a landmine default. Anyone pointing at a managed Postgres over WAN will send ciphertext-at-rest over a plaintext wire.

**Fix:**
- Default to `require` in `.env.example`.
- Override to `disable` in the Docker Compose files with an inline comment ("loopback only within compose network").

---

### H13. No release / supply-chain integrity

**Where:** `architecture.md` §M14.

goreleaser + GHCR + Docker Hub, no cosign signatures, no SLSA provenance, no SBOM. A tampered `v1.0.1` image compromises every user's vault.

**Fix:** cosign-sign every artifact, publish SLSA L3 provenance, attach SBOM, document `cosign verify` in install docs. Non-negotiable for a credential vault.

---

## 6. Medium Findings

### M1. Audit logs retain IP + user-agent for 365 days

**Where:** `prd.md` §9.8, `architecture.md` §5.3 (line 310).

In a zero-knowledge product, 365 days of per-user IP + activity timing is a serious metadata leak under DB compromise and a GDPR exposure.

**Fix:**
- Truncate IPs to /24 (IPv4) or /56 (IPv6), or hash them.
- Consider a tiered retention: 30 days for raw IP/UA, 365 days for anonymised action log.

---

### M2. Backup file + server key co-location risk

**Where:** `prd.md` §17.4, `architecture.md` §M12.

The Postgres dump contains server-encrypted TOTP secrets and the audit log. If the operator backs up the `.env` file alongside the DB dump (common mistake), TOTP secrets decrypt offline and all audit metadata leaks.

**Fix:** document loudly that the DB backup and the server encryption key MUST be backed up to **different locations with different access policies**. Add a CI assertion that `.env` is not in the backup directory.

---

### M3. `ON DELETE CASCADE` on `vault_members` destroys compliance trail

**Where:** `prd.md` §9.2 (line 584).

When a user is removed, the membership row is gone — you can't later prove who had access to what at a given past time.

**Fix:** soft-delete `vault_members` (add `removed_at TIMESTAMPTZ`), OR log membership deltas to `audit_logs` with enough info to reconstruct the full membership history.

---

### M4. Personal vaults use RSA wrapping unnecessarily

**Where:** `architecture.md` §4.1 (registration, lines 151-153).

For a single-user personal vault, wrapping the vaultKey with the user's RSA public key (which must then be unwrapped via the stretched-key-decrypted RSA private key) is pure overhead. Direct `AES-KW(stretchedKey, vaultKey)` is simpler and removes a class of bugs.

**Fix:** only introduce RSA wrapping when a vault is actually shared. Personal vaults use direct AES key-wrap.

---

### M5. `encrypted_name` leaks plaintext length

**Where:** `prd.md` §9.3, §9.4. `architecture.md` §5.2 (lines 299-300).

AES-GCM preserves plaintext length. `encrypted_name` ciphertext length = name plaintext length. Over a dump, this fingerprints items.

**Fix:** pad names to the next 32-byte boundary before encryption (PKCS#7-style). Document the padding scheme.

---

### M6. No export-level integrity (MAC over the envelope)

**Where:** `architecture.md` §M9 (export), `prd.md` §10.6.

Per-item GCM tags protect individual items but not the export envelope. An attacker-in-middle can swap one ciphertext for another without breaking any MAC.

**Fix:** include a file-level Merkle root (or HMAC) over all item IDs + ciphertexts, signed with the user's identity key or stretchedKey.

---

### M7. CSRF story is ambiguous

**Where:** `prd.md` §7.4 threat model: "SameSite cookies + CSRF tokens".

JWTs in cookies and JWTs in `Authorization: Bearer` have different CSRF profiles. The doc uses both languages without picking one.

**Fix:** pick one model explicitly:
- **Header-only** (`Authorization: Bearer`): no CSRF concerns, but XSS → full account takeover.
- **Cookie + CSRF token**: HttpOnly + SameSite=Strict + double-submit CSRF token.

Document the choice and enforce it in middleware.

---

### M8. CSP policy not specified

**Where:** `architecture.md` §6.2 ("CSP strict").

WASM Argon2id requires `wasm-unsafe-eval`. Without a locked-down, enumerated policy, XSS mitigation is unverifiable.

**Fix:** commit the exact CSP header:
```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

Plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: interest-cohort=()`, `Cross-Origin-Opener-Policy: same-origin`.

---

### M9. Client key persistence across reloads is undefined

**Where:** `architecture.md` §M7 acceptance criteria (line 587): "No secrets in URL or localStorage (in-memory only)".

"In-memory only" for an SPA means decrypted keys vanish on every page reload → awful UX that will later invite shortcuts. No defined strategy (sessionStorage? service worker? IndexedDB with encryption?).

**Fix:** pick a concrete strategy and document it. Recommended: keep `stretchedKey` in a Web Worker or Service Worker scope, sealed behind an auto-lock timer. Document the reload UX explicitly.

---

### M10. Row-level security migration is a one-liner landmine

**Where:** `architecture.md` §11.1 (line 804).

"Row-level security policies enforce tenant isolation" — the most common RLS bug is forgetting `WITH CHECK`, which allows writes to end up in the wrong tenant.

**Fix:** commit concrete RLS policy templates alongside the migration. Every policy must have BOTH `USING` and `WITH CHECK` clauses. Add cross-tenant integration tests.

---

### M11. Invite tokens are under-specified

**Where:** `architecture.md` §M8 (invite flow, line 599), `prd.md` §5.3.

"Invite flow (email + link)" — no format, TTL, or lifecycle defined.

**Fix:** 256-bit random, single-use, 24–72h TTL, stored as HMAC in DB, rate-limited redemption. Revoke on role change or inviter removal.

---

### M12. No user-recovery story

**Where:** not mentioned anywhere in `prd.md` or `architecture.md`.

Zero-knowledge means losing the master password = losing the vault. This is correct — but giving users no recovery kit will cause catastrophic data loss on day one.

**Fix:** add a "Recovery Kit" to the registration flow: generate a second, printable decryption key that can unlock `encrypted_private_key`. Shown once, never stored server-side. Model: Bitwarden's emergency sheet.

---

## 7. Informational / Future-Proofing

| Topic | Note |
|-------|------|
| RSA-2048 lifetime | NIST SP 800-57 moves 2048-bit RSA to legacy status after 2030. Commit to an X25519 / HPKE migration plan now (enabled by C5). |
| OPAQUE / SRP-6a | Future password-protocol upgrade to eliminate the authHash-on-wire exposure from C4. Track for v2. |
| Enum types | `role VARCHAR(50)` across many tables invites typo-driven authz bugs (`'Admin'` vs `'admin'`). Use Postgres ENUM or a constrained domain. |
| Single-node cron | Trash/session purge via cron inside the API server is a self-hosted-only pattern; cloud deployment needs a dedicated worker or a leader-election mechanism. |
| External crypto review | `architecture.md` risk register already flags this. Budget for an independent crypto review before v1.0 release. |
| Admin bootstrap | First admin creation in invite-only mode is unspecified — document a `vaultctl admin init` CLI command or similar. |
| IP logging privacy toggle | Self-hosted users are often both the user and the operator; add `VAULTCTL_LOG_IP=false` for privacy-conscious deployments. |

---

## 8. Action Checklist (Pre-M0)

- [ ] C1 — Add identity-key signing to user registration & sharing flows
- [ ] C2 — Rewrite member-removal rule: unconditional vault rekey + item re-encryption
- [ ] C3 — Hash refresh tokens at rest (schema change: `refresh_token_hash`)
- [ ] C4 — Document authHash redaction rule + logging-middleware enforcement
- [ ] C5 — Commit ciphertext versioning spec and allowed-alg enumeration
- [ ] H2 — Prelogin returns deterministic fake salt for unknown emails
- [ ] H5 — Add `VAULTCTL_DATA_ENCRYPTION_KEY` to env template + rotation docs
- [ ] H8 — Document JWT signing-key rotation procedure
- [ ] H12 — Flip `VAULTCTL_DB_SSL_MODE` default to `require`
- [ ] H13 — Commit to cosign-signing release artifacts
- [ ] M9 — Pick and document client key-persistence strategy
- [ ] M12 — Design Recovery Kit flow

---

## 9. Sign-off Gate for v1.0

Before public launch:

- All Critical and High findings resolved
- External crypto review scheduled and passed
- `govulncheck` + `gosec` clean
- OWASP ZAP scan clean (no high-severity)
- Cross-vault IDOR test suite green
- Log-redaction tests assert `authHash` never appears in any log line
- Release artifacts signed with cosign + SLSA L3 provenance published
