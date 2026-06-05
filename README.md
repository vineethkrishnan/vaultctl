# vaultctl

Self-hosted, zero-knowledge password vault. Single Go binary serves the API and the embedded React SPA. Browser extension and CLI talk to the same server. AGPL-3.0.

- **Zero-knowledge by construction.** Argon2id key derivation and AES-256-GCM happen in the browser worker, the extension, or the CLI. The server has no code path to decrypt.
- **One binary, one image.** The web bundle is embedded into the Go binary. Final container image is ~45MB on `gcr.io/distroless/static-debian12:nonroot`.
- **Multi-user from day 1.** Organizations, invites, role-based vault sharing, RSA-OAEP wrap with Ed25519 signature pinning, member-removal triggers a vault rekey.
- **Supply-chain hardened.** goreleaser builds for linux/darwin/windows × amd64/arm64; cosign keyless signing on every artifact; CycloneDX SBOM per archive; SLSA-L3 provenance attestation on public releases.

Docs: [vaultctl.vinelabs.de](https://vaultctl.vinelabs.de)

## Quick start (self-host)

```bash
git clone https://github.com/vineethkrishnan/vaultctl.git
cd vaultctl
cp .env.example .env
# fill in every secret - server fail-closes if any prod secret is empty.
# generate values with: openssl rand -base64 32   (or 64 for JWT secrets)

docker compose up -d                              # starts caddy + vaultctl + postgres
docker compose exec vaultctl vaultctl migrate up  # apply embedded migrations
```

Open `https://${VAULTCTL_BASE_URL}` and register the first user. Without a TLS-terminating proxy, use `docker-compose.simple.yml` and front it with your own reverse proxy on `127.0.0.1:8080`.

Step-by-step screenshots of the registration -> recovery-kit -> first-item flow: [`docs/setup/walkthrough.md`](docs/setup/walkthrough.md).

The bundled compose sets `VAULTCTL_DB_SSL_INSECURE_OK=true` because Postgres lives on a private bridge network. For any deploy where the DB is reachable across hosts, leave this unset and configure `VAULTCTL_DB_SSL_MODE=verify-full`.

## CLI

```bash
go install github.com/vineethkrishnan/vaultctl/cmd/server@latest
# or grab a signed binary from the latest release

export VAULTCTL_API_URL=https://vault.example.com
vaultctl login
vaultctl ls
vaultctl get GitHub
vaultctl add login --name Reddit
vaultctl backup --output /var/backups/vaultctl
```

The same binary runs the server (`vaultctl server`), applies migrations (`vaultctl migrate up|down`), and runs the client commands. `--json` is honored on every read command.

## Browser extension (MV3)

```bash
cd extension
npm ci
npm run build           # outputs .output/chrome-mv3
```

Load `extension/.output/chrome-mv3` via `chrome://extensions` -> Developer mode -> Load unpacked. Firefox: `about:debugging`.

## Development

Toolchain: Go 1.22+, Node 22+, Docker (with `docker compose`), and GNU `make`. The `make` targets below are thin wrappers around `go build` / `npm` / `golangci-lint` / `gosec` / `govulncheck` - install any tool the target needs that you don't already have.

```bash
make web-build          # build the SPA (embedded into the Go binary)
make build              # build the vaultctl binary
make run                # run the server locally on :8080
make test               # go test ./... -race -count=1 -coverprofile=coverage.out
make lint               # golangci-lint run ./...
make sec                # gosec + govulncheck
```

Web dev server (proxies `/api` to `http://localhost:8080`):

```bash
cd web
npm ci
npm run dev             # http://localhost:5173
npm run typecheck       # tsc --noEmit
npm run test            # vitest
npm run test:e2e        # playwright (35 e2e tests)
```

## Verifying releases

vaultctl publishes four layers of supply-chain evidence. For credential-vault use you should verify at least the layer matching how you install. Step-by-step verification commands: [`docs/security/verifying-releases.md`](docs/security/verifying-releases.md).

| Layer | What it proves |
| --- | --- |
| `cosign verify-blob` against `checksums.txt` | the binary tarball matches what the release workflow built |
| `cosign verify` against the container manifest | the image digest you pulled was produced by the release workflow |
| SLSA build provenance attestation | a named GitHub workflow at a specific tag produced the artifact |
| CycloneDX SBOM (`*.sbom.cdx.json`) | complete dependency inventory for review and vuln scanning |

## Project layout

```
cmd/server/                   # binary entry: server, migrate, backup, admin, client cmds
internal/domain/              # core types and invariants - no I/O
internal/application/         # use cases composed from ports
internal/infrastructure/      # postgres, JWT, crypto adapters
internal/presenters/api/      # chi router, handlers, middleware
internal/presenters/cli/      # cobra command tree
migrations/                   # *.sql, embedded into the binary
web/                          # React + Vite SPA, embedded into the binary
extension/                    # WXT + MV3 browser extension
deploy/caddy/                 # Caddyfile for the bundled stack
docs/security/                # release verification guide
docs-site/                    # public docs site (deployed to Cloudflare Pages)
```

## License

AGPL-3.0. See [`LICENSE`](LICENSE).
