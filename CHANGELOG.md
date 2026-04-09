# Changelog

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
