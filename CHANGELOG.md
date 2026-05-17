# Changelog

## [1.4.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.3.1...v1.4.0) (2026-05-17)


### Features

* **auth:** bootstrap first user as owner on fresh install ([#74](https://github.com/vineethkrishnan/vaultctl/issues/74)) ([b02e1aa](https://github.com/vineethkrishnan/vaultctl/commit/b02e1aad1d3c3b7a97990516ae53b5893cd99efb))
* **web:** apply theme on first paint so pre-auth pages honor the user's preference ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))
* **web:** label every Field input via `htmlFor`/`id` for screen-reader access and automated tests ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))


### Bug Fixes

* **build:** inject the binary version into the right symbol so `make build` and `docker build` no longer report `dev (dev)` ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))
* **build:** fall back to `CHANGELOG.md` for the version when building from a source tarball without `.git` ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))
* **compose:** point `docker-compose.yml` and `docker-compose.simple.yml` at the primary GHCR registry instead of the Docker Hub mirror ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))
* **cli:** remove the non-functional `vaultctl admin init` stub now that the first-user bypass supersedes it ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))


### Documentation

* add `make` to the README development prerequisites and update the setup walkthrough screenshots ([#75](https://github.com/vineethkrishnan/vaultctl/issues/75)) ([b035baf](https://github.com/vineethkrishnan/vaultctl/commit/b035baf4f226d8c0116aa367d5b19f9eb8b622d1))

## [1.3.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.3.0...v1.3.1) (2026-05-10)


### Documentation

* add docs site link to README ([68205ca](https://github.com/vineethkrishnan/vaultctl/commit/68205caa672b22b6a6feaaaf098ed2f2a7507222))

## [1.3.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.2.1...v1.3.0) (2026-05-09)


### Features

* **ci:** add playwright e2e workflow and 404 reserved server prefixes ([#59](https://github.com/vineethkrishnan/vaultctl/issues/59)) ([fe6e16d](https://github.com/vineethkrishnan/vaultctl/commit/fe6e16d26995795c5dbbd72553f304bb25af61ce))


### Bug Fixes

* **web:** drain response body so chromium reports requestfinished ([#62](https://github.com/vineethkrishnan/vaultctl/issues/62)) ([b2cf8ec](https://github.com/vineethkrishnan/vaultctl/commit/b2cf8ec9ade121b1d0f9b31fe81b106b1997ebec))

## [1.2.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.2.0...v1.2.1) (2026-05-09)


### Bug Fixes

* make first-time production deploy actually work ([#58](https://github.com/vineethkrishnan/vaultctl/issues/58)) ([5b0e0c8](https://github.com/vineethkrishnan/vaultctl/commit/5b0e0c8074e6941a35166a84349c409a78f8fccf))

## [1.2.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.6...v1.2.0) (2026-04-12)


### Features

* **api:** complete all architecture endpoints — 53 total ([#32](https://github.com/vineethkrishnan/vaultctl/issues/32)) ([0e3c25c](https://github.com/vineethkrishnan/vaultctl/commit/0e3c25c0c2d0d6fc7db18e336cf294d10f0d7e30))
* swagger UI, 48 API endpoints, orval codegen, security hardening ([#30](https://github.com/vineethkrishnan/vaultctl/issues/30)) ([c882a61](https://github.com/vineethkrishnan/vaultctl/commit/c882a615216c449a57213f7e970f93736bd46df2))


### Bug Fixes

* **web:** import dialog vault picker + unskip sessions e2e ([#33](https://github.com/vineethkrishnan/vaultctl/issues/33)) ([297a86a](https://github.com/vineethkrishnan/vaultctl/commit/297a86a9cad2882b3b071a8dbc7b8664cfa6347f))

## [1.1.6](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.5...v1.1.6) (2026-04-09)


### Bug Fixes

* **docker:** default to server cmd, latest tag, and docker hub registry ([4ce525b](https://github.com/vineethkrishnan/vaultctl/commit/4ce525bd7129b7df162f5882761df1485af5de2c))

## [1.1.5](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.4...v1.1.5) (2026-04-09)


### Documentation

* **docs:** add all installation methods ([#27](https://github.com/vineethkrishnan/vaultctl/issues/27)) ([c31ed02](https://github.com/vineethkrishnan/vaultctl/commit/c31ed02bab584b6cdf973e93ea46aca1b606908a))

## [1.1.4](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.3...v1.1.4) (2026-04-09)


### Bug Fixes

* **ci:** deploy docs to production branch on cloudflare pages ([#25](https://github.com/vineethkrishnan/vaultctl/issues/25)) ([f38e16e](https://github.com/vineethkrishnan/vaultctl/commit/f38e16ed6cbd54d576811e1cf1deed67dbf3e73c))

## [1.1.3](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.2...v1.1.3) (2026-04-09)


### Bug Fixes

* **ci:** pass cloudflare credentials as env vars for wrangler ([#23](https://github.com/vineethkrishnan/vaultctl/issues/23)) ([1de4da6](https://github.com/vineethkrishnan/vaultctl/commit/1de4da6d34bb2889caab0ad8800fa0237584ab93))

## [1.1.2](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.1...v1.1.2) (2026-04-09)


### Bug Fixes

* **ci:** move docs deploy to release workflow, match backupctl pattern ([#21](https://github.com/vineethkrishnan/vaultctl/issues/21)) ([913683d](https://github.com/vineethkrishnan/vaultctl/commit/913683d8dac5831c26a3b8b3c834b9a90f719bb8))

## [1.1.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.1.0...v1.1.1) (2026-04-09)


### Bug Fixes

* **ci:** skip SLSA attestation on private repos ([77e6e7a](https://github.com/vineethkrishnan/vaultctl/commit/77e6e7a21be132bbeb0c956ed2e3d68d8080c864))
* **docs:** repair cloudflare pages deployment for docs-site ([#20](https://github.com/vineethkrishnan/vaultctl/issues/20)) ([def6f41](https://github.com/vineethkrishnan/vaultctl/commit/def6f4110a5263ea39de25d15b57f79adba111b7))

## [1.1.0](https://github.com/vineethkrishnan/vaultctl/compare/v1.0.1...v1.1.0) (2026-04-07)


### Features

* initial commit — backend M0-M14, docs-site, installer, CI/CD ([50c1d6a](https://github.com/vineethkrishnan/vaultctl/commit/50c1d6a9470f0342e6fdb58ac8c7e40572dc9e1f))


### Bug Fixes

* **ci:** allow 'main' scope for release-please PRs, tidy go.mod ([755fa03](https://github.com/vineethkrishnan/vaultctl/commit/755fa03e67f512be4154fca079d15c1e615e0a87))
* **ci:** bump go 1.25→1.26, fix golangci-lint action, exclude gosec G115/G204 ([cfa0dc3](https://github.com/vineethkrishnan/vaultctl/commit/cfa0dc371fda0d5c4f3ad27a6236e6d9b55ddfc6))
* **ci:** bump go 1.26.0→1.26.1 to resolve stdlib CVEs ([58777a0](https://github.com/vineethkrishnan/vaultctl/commit/58777a09cbcede010e6308c6a5392dab038665a7))
* **ci:** bump golangci-lint to v1.64, exclude gosec G107 ([5113ba1](https://github.com/vineethkrishnan/vaultctl/commit/5113ba1a69459025d6fcb768cc5dcadf719c2218))
* **ci:** correct Docker Hub username to vineethnkrishnan ([66f4086](https://github.com/vineethkrishnan/vaultctl/commit/66f4086797b2e4c739890605269c651e5add9ad6))
* **ci:** migrate golangci-lint config to v2 schema ([fd8fca6](https://github.com/vineethkrishnan/vaultctl/commit/fd8fca6b655f2e8071a1cea50b21642e978edd01))
* **ci:** resolve all golangci-lint v2 findings ([c99880f](https://github.com/vineethkrishnan/vaultctl/commit/c99880f3389814a7a21c763464d7ef1123d48ef2))
* **ci:** upgrade to golangci-lint v2 (v1.x can't parse go 1.26 deps) ([8afe23b](https://github.com/vineethkrishnan/vaultctl/commit/8afe23b3c875c6c52e69a5381315005b07c83481))
* **ci:** use explicit golangci-lint version v2.1 ([ee98a66](https://github.com/vineethkrishnan/vaultctl/commit/ee98a6652e030bb21781b8420c0203ad909ef6a5))
* **ci:** use go-version-file instead of hardcoded Go version ([a97ee0d](https://github.com/vineethkrishnan/vaultctl/commit/a97ee0d2ca3014d70c89d6ae1d863b2ec94b61d2))
* **ci:** use golangci-lint v2.11 (built with go 1.26) ([77b4f97](https://github.com/vineethkrishnan/vaultctl/commit/77b4f9778d4bf4cd28588b5f364d6a37a14ceaa7))
* **ci:** use minimal Dockerfile for goreleaser, fix Docker Hub description ([5e2339b](https://github.com/vineethkrishnan/vaultctl/commit/5e2339b005a1ae69572d443b88cbd322c3f89ae7))


### CI/CD

* **deps:** bump the actions group with 12 updates ([852c14a](https://github.com/vineethkrishnan/vaultctl/commit/852c14ac76738bfc2e87ece7a9b0dad2f189c9c1))
* **release:** add release-please, branch/tag protection, dependabot ([d012180](https://github.com/vineethkrishnan/vaultctl/commit/d0121805a4bc0ccdaa34259fc95614ba928231ac))

## [1.0.1](https://github.com/vineethkrishnan/vaultctl/compare/v1.0.0...v1.0.1) (2026-04-07)


### Bug Fixes

* **ci:** use minimal Dockerfile for goreleaser, fix Docker Hub description ([5e2339b](https://github.com/vineethkrishnan/vaultctl/commit/5e2339b005a1ae69572d443b88cbd322c3f89ae7))

## 1.0.0 (2026-04-07)


### Features

* initial commit — backend M0-M14, docs-site, installer, CI/CD ([50c1d6a](https://github.com/vineethkrishnan/vaultctl/commit/50c1d6a9470f0342e6fdb58ac8c7e40572dc9e1f))


### Bug Fixes

* **ci:** allow 'main' scope for release-please PRs, tidy go.mod ([755fa03](https://github.com/vineethkrishnan/vaultctl/commit/755fa03e67f512be4154fca079d15c1e615e0a87))
* **ci:** bump go 1.25→1.26, fix golangci-lint action, exclude gosec G115/G204 ([cfa0dc3](https://github.com/vineethkrishnan/vaultctl/commit/cfa0dc371fda0d5c4f3ad27a6236e6d9b55ddfc6))
* **ci:** bump go 1.26.0→1.26.1 to resolve stdlib CVEs ([58777a0](https://github.com/vineethkrishnan/vaultctl/commit/58777a09cbcede010e6308c6a5392dab038665a7))
* **ci:** bump golangci-lint to v1.64, exclude gosec G107 ([5113ba1](https://github.com/vineethkrishnan/vaultctl/commit/5113ba1a69459025d6fcb768cc5dcadf719c2218))
* **ci:** migrate golangci-lint config to v2 schema ([fd8fca6](https://github.com/vineethkrishnan/vaultctl/commit/fd8fca6b655f2e8071a1cea50b21642e978edd01))
* **ci:** resolve all golangci-lint v2 findings ([c99880f](https://github.com/vineethkrishnan/vaultctl/commit/c99880f3389814a7a21c763464d7ef1123d48ef2))
* **ci:** upgrade to golangci-lint v2 (v1.x can't parse go 1.26 deps) ([8afe23b](https://github.com/vineethkrishnan/vaultctl/commit/8afe23b3c875c6c52e69a5381315005b07c83481))
* **ci:** use explicit golangci-lint version v2.1 ([ee98a66](https://github.com/vineethkrishnan/vaultctl/commit/ee98a6652e030bb21781b8420c0203ad909ef6a5))
* **ci:** use go-version-file instead of hardcoded Go version ([a97ee0d](https://github.com/vineethkrishnan/vaultctl/commit/a97ee0d2ca3014d70c89d6ae1d863b2ec94b61d2))
* **ci:** use golangci-lint v2.11 (built with go 1.26) ([77b4f97](https://github.com/vineethkrishnan/vaultctl/commit/77b4f9778d4bf4cd28588b5f364d6a37a14ceaa7))


### CI/CD

* **deps:** bump the actions group with 12 updates ([852c14a](https://github.com/vineethkrishnan/vaultctl/commit/852c14ac76738bfc2e87ece7a9b0dad2f189c9c1))
* **release:** add release-please, branch/tag protection, dependabot ([d012180](https://github.com/vineethkrishnan/vaultctl/commit/d0121805a4bc0ccdaa34259fc95614ba928231ac))
