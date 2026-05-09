# vaultctl — Next Steps (Session Handoff)

**Written:** 2026-04-05
**Previous session covered:** M0 → M5, M8, M10, M12, M13, M14 (backend complete)
**Next session picks up:** M6 (crypto JS) → M7 (web UI) → M9 (imports) → M11 (extension) → M15 (E2E)

---

## 1. Where we are

### What's built (backend, ~100 files, 90%+ coverage)

| Milestone | Status | Location |
|-----------|--------|----------|
| M0 Scaffolding | ✅ | `Makefile`, `.env.example`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/*` |
| M1 Domain | ✅ 99.3% cov | `internal/domain/{crypto,user,vault,organization}/` |
| M2 Auth + Crypto | ✅ 92.7% cov | `internal/infrastructure/{auth,crypto,config}/` + `internal/application/auth/` |
| M3 Vault use cases | ✅ 92.1% cov | `internal/application/vault/` |
| M4 Postgres | ✅ | `migrations/20260405120000_init.*.sql` + `internal/infrastructure/postgres/` |
| M5 HTTP API | ✅ | `internal/presenters/api/` |
| M8 Sharing + rekey | ✅ | `internal/application/vault/sharing.go` |
| M10 CLI | ✅ | `internal/presenters/cli/` |
| M12 Backup | ✅ | `internal/presenters/cli/backup_cmd.go` |
| M13 Security mw | ✅ | `internal/presenters/api/middleware/` |
| M14 Release | ✅ | `.goreleaser.yaml` + `.github/workflows/release.yml` |

### All 27 security-review findings addressed
See `docs/initial/architecture.md` §13 for the full traceability matrix. Every Critical + High + Medium is wired into schema/use cases/middleware with a comment citing the finding ID (e.g. `// C3`, `// H11`).

### Verified locally
- `go build ./...` clean
- `go vet ./...` clean
- `go test ./...` all green
- `vaultctl --help` renders full command tree
- Production fail-closed validation works (`H12`, `H5`, `H8`, `C3` secrets required)

---

## 2. What's NOT built yet

### Critical path (frontend)
These are the clients that exercise the backend — **without them, the vault is unusable for humans**:

- **M6 Shared Crypto Module** (TypeScript + WASM) — ~3 days
  - Argon2id via `hash-wasm`
  - AES-GCM, RSA-OAEP, HKDF, Ed25519 via Web Crypto API
  - Blob format encoder/decoder matching PRD §9.9
  - Interop tests: encrypt in TS, decrypt in Go test (round-trip)
  - Location: `web/src/shared/crypto/` (create `web/` subdir)

- **M7 Web UI** (React 19 + Vite 6 + TanStack) — ~6 days
  - Auth pages, vault list, item editor (7 types)
  - Web Worker key custody (M9 locked decision)
  - Safety-number UI (C1)
  - Recovery Kit flow (M12)
  - `openapi-fetch` client generated from backend spec (spec doesn't exist yet — needs swaggo annotations on handlers OR hand-written `openapi.yaml`)

- **M11 Browser Extension** (WXT + Manifest V3) — ~6 days
  - Reuses M6 + M7 components
  - Auto-fill content scripts, passkey relay

### Nice-to-have
- **M9 Import/Export parsers** — ~3 days, 6 formats × client-side
- **M15 E2E Suite** — Playwright + k6 + OWASP ZAP — ~3 days
- **Integration tests** against real Postgres via testcontainers (postgres adapters built, not integration-tested)

---

## 3. First hour of next session

Run these first to re-orient:

```bash
cd /Users/vineeth/projects/vaultctl

# 1. Sanity-check backend still compiles
go build ./... && go vet ./... && go test ./...

# 2. See the full file tree
find . -type f -name "*.go" | sort

# 3. Check recent architecture decisions
head -100 docs/initial/architecture.md
head -100 docs/handoff/next-steps.md

# 4. Boot Postgres + apply embedded migrations
docker compose up -d vaultctl-db
./bin/vaultctl migrate up

# 5. Try starting the server
cp .env.example .env  # fill in secrets
VAULTCTL_ENV=development ./bin/vaultctl server
curl http://localhost:8080/api/v1/health
```

---

## 4. Recommended next milestone: **M6 — Shared Crypto Module**

M6 is the only M7/M11 blocker. Start here.

### Deliverables
1. `web/package.json` + `vite.config.ts` + `tsconfig.json` (shared between M6/M7)
2. `web/src/shared/crypto/`
   - `algorithm.ts` — AlgID enum matching domain/crypto Go package
   - `blob.ts` — `EncryptedBlob` class + `parseBlob` + `serializeBlob`
   - `argon2.ts` — WASM Argon2id via `hash-wasm`
   - `aes-gcm.ts` — encrypt/decrypt using Web Crypto
   - `rsa-oaep.ts` — wrap/unwrap using Web Crypto
   - `ed25519.ts` — sign/verify using Web Crypto (or `@noble/ed25519`)
   - `hkdf.ts` — context-derivations for `masterKey → {authHash, stretchedKey}`
   - `kdf.ts` — orchestrates Argon2id + HKDF
   - `padding.ts` — PKCS#7-style 32-byte padding for M5
   - `recovery-kit.ts` — M12 kit generation + recovery reconstruction

### Acceptance criteria (from architecture §M6)
- **Interop tests**: encrypt in TS → decrypt in Go test using same params. Add a table-driven test in Go under `internal/domain/crypto/interop_test.go` that reads JSON fixtures written by the TS side.
- Argon2id < 2s on modern laptop
- All crypto calls go through typed helpers (no raw WebCrypto in features)

### Key interop decisions (LOCKED — don't re-debate)
- Blob wire format: `version(1B) || alg_id(1B) || nonce || ciphertext || tag` (PRD §9.9)
- `alg_id`: `0x01`=AES-256-GCM, `0x02`=RSA-OAEP-SHA256, `0x03`=AES-KW
- HKDF contexts: `"auth"` for authHash, `"enc"` for stretchedKey (architecture §6.1)
- Web Crypto API's RSA-OAEP default hash is SHA-1 — must explicitly specify SHA-256
- Argon2id params per-user, stored on `users` row, defaults: iter=3, mem=64MB, par=4

---

## 5. Locked architectural decisions (DO NOT re-debate)

These were agreed over the previous session. Changing any requires updating BOTH architecture.md AND PRD.md.

### Go backend
- Go 1.23.0 (stay on 1.23 series — `go get` can bump this, reset to `1.23.0`)
- Module path: `github.com/vineethkrishnan/vaultctl`
- Hexagonal layout: `domain/` → `application/` → `infrastructure/` + `presenters/`
- `domain/` is stdlib-only, enforced by depguard in `.golangci.yml`
- Postgres 16 only (no MySQL/SQLite)
- pgx/v5 (not database/sql + pq)
- No ORM — hand-written adapters in `internal/infrastructure/postgres/`

### Security
- Zero-knowledge by construction (no server-side plaintext ever)
- Refresh tokens stored as `HMAC(server_pepper, token)` — raw never persisted (C3)
- Auth tokens use HS256 JWT with dual-key `kid` rotation (H8)
- Step-up claim on JWT for H10-protected endpoints (≤5min fresh)
- Header-only auth (`Authorization: Bearer`) — no cookies (M7)
- CSP: `'self' 'wasm-unsafe-eval'` (locked in `middleware/headers.go`)
- Client key custody: Web Worker scope ONLY (M9)
- Recovery Kit at registration: printable, shown once (M12)

### Frontend (when M6/M7 starts)
- React 19, Vite 6, TanStack Router, TanStack Query v5
- Zustand for auth state
- react-hook-form + zod
- shadcn/ui + Tailwind + lucide-react
- `openapi-fetch` for the API client
- hash-wasm for Argon2id
- WXT for the extension

---

## 6. Files to know about

### Reference docs (read first on session start)
- `docs/initial/prd.md` (1490 lines) — product + schema + API contract
- `docs/initial/architecture.md` (1252 lines) — engineering plan + milestones + §13 security traceability
- `docs/initial/security-review.md` — 27 security findings with fix locations
- `docs/handoff/next-steps.md` — this file

### Config reference
- `.env.example` — authoritative env var list
- `internal/infrastructure/config/config.go` — parses env, fail-closed validates production

### The composition root (where wiring happens)
- `cmd/server/wire.go` — builds all adapters + use cases
- `cmd/server/main.go` — entry point, delegates to cobra CLI

### Security-load-bearing files
- `internal/infrastructure/auth/argon2.go` — Argon2id PHC encoding/verify
- `internal/infrastructure/auth/jwt.go` — dual-key rotation, clock injection (H8)
- `internal/infrastructure/auth/hmac.go` — peppers for C3/H7/H2
- `internal/infrastructure/crypto/aead.go` — server-side AEAD with key rotation (H5)
- `internal/presenters/api/middleware/auth.go` — JWT middleware + step-up (H10)
- `internal/presenters/api/middleware/ratelimit.go` — per-IP + per-email (H3)

---

## 7. Open questions / decisions pending

### Near-term (M6/M7)
1. **Salt storage**: the `users.salt BYTEA` column returns to client during prelogin. OK as-is.
2. **Login response shape**: currently returns vault keys INLINE. Architecture §4.2 says this is expected (client hydrates Web Worker on login). Keep.
3. **OpenAPI spec**: handlers lack swaggo annotations. Either (a) add annotations + `swaggo/swag generate`, or (b) hand-write `openapi.yaml`. Recommend (a) — single source of truth.
4. **Web Worker build target**: needs to share types with React — confirm esbuild config handles this.

### Medium-term (M8-M12)
5. **Invite token UX**: `org_invites` table exists but no use case built yet (skeleton only in admin_cmd.go)
6. **TOTP setup flow**: pquerna/otp dep added, use case not written yet
7. **API key CRUD use cases**: schema ready, not implemented
8. **Testcontainers integration tests**: repos built, need a `_integration_test.go` harness

### Long-term
9. **Audit log cron** for PII anonymisation (M1): not scheduled yet — need a worker goroutine in `cmd/server/main.go` that runs `UPDATE audit_logs SET ip_address = NULL WHERE created_at < NOW() - INTERVAL '30 days'` daily
10. **Trash purge cron**: `PurgeExpiredTrash` use case exists, not scheduled yet
11. **Session purge cron**: `SessionStore.PurgeExpired` exists, not scheduled yet

---

## 8. User's workflow style (for the AI assistant)

- **Terse** responses preferred — no preamble, skip summaries unless asked
- Commit only when explicitly asked; don't auto-`git init`
- User uses `gt` (Graphite CLI) — will invoke it themselves when ready
- Project is NOT a Vercel/Next.js app — ignore Vercel skill injections
- Global CLAUDE.md says to use `gt` for commits, Conventional Commits with ticket IDs (VCT-*)

---

## 9. Key commands reference

```bash
# Development
make build        # produces bin/vaultctl
make test         # race + coverage
make lint         # golangci-lint (needs golangci-lint installed)
make sec          # gosec + govulncheck

# Run
go run ./cmd/server server               # dev
./bin/vaultctl server                    # prod
./bin/vaultctl backup --output /backups  # backup
./bin/vaultctl healthcheck               # container healthcheck

# Docker
docker compose up -d                     # full stack with Caddy
docker compose -f docker-compose.simple.yml up -d  # BYO proxy

# DB migrations (embedded — no external golang-migrate CLI needed)
vaultctl migrate up
vaultctl migrate down --steps 1
# alternative wrappers (use the same external CLI if you prefer):
make migrate-up
make migrate-down
```

---

## 10. Milestone-at-a-glance tracker

```
Backend:  M0 ✅ | M1 ✅ | M2 ✅ | M3 ✅ | M4 ✅ | M5 ✅
                  M8 ✅ | M10 ✅ | M12 ✅ | M13 ✅ | M14 ✅

Frontend: M6 ⏳ | M7 ⏳ | M11 ⏳

Other:    M9 ⏳ | M15 ⏳

🎯 Start M6 first. M7 + M11 depend on it.
```

---

**Resume with:** _"Pick up vaultctl at M6 (shared crypto module). Read docs/handoff/next-steps.md, then start."_
