# Verifying vaultctl Releases

**You are running a credential vault. Verify every release before you install it.**

vaultctl publishes three layers of supply-chain evidence for every tagged
release, all signed by GitHub Actions OIDC (keyless Sigstore - no private
keys anywhere). You MUST verify at least the layer you use to install.

| Layer | What it proves | Required for |
| --- | --- | --- |
| **cosign blob signature on `checksums.txt`** | Every binary artifact matches what the release workflow built | Binary downloads (`.tar.gz`, `.zip`) |
| **cosign container image signature** | The image digest you pulled was produced by the release workflow | Docker / OCI installs |
| **SLSA build provenance attestation** | A named GitHub workflow at a specific tag produced the artifact | High-assurance / audited environments |
| **CycloneDX SBOM** | Complete dependency inventory for review or vuln scanning | Security review, vuln scanning, compliance |

All four are published as GitHub Release assets alongside every tag on
<https://github.com/vineethkrishnan/vaultctl/releases>.

---

## Prerequisites

Install cosign v2+ (keyless verification):

```sh
# macOS
brew install cosign

# Linux
curl -sSfL https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 \
  -o /usr/local/bin/cosign && chmod +x /usr/local/bin/cosign

# Verify
cosign version
```

No API keys, no private keys, no accounts - cosign verifies against the
public Sigstore transparency log (Rekor).

## The identity you are verifying against

Every vaultctl artifact is signed by the GitHub Actions runner that ran
`.github/workflows/release.yml` on a `v*` tag push. Two values pin that:

| Variable | Value |
| --- | --- |
| `CERT_IDENTITY_REGEX` | `^https://github\.com/vineethkrishnan/vaultctl/\.github/workflows/release\.yml@refs/tags/v` |
| `CERT_OIDC_ISSUER` | `https://token.actions.githubusercontent.com` |

Export them once per shell so the commands below are copy-pasteable:

```sh
export CERT_IDENTITY_REGEX='^https://github\.com/vineethkrishnan/vaultctl/\.github/workflows/release\.yml@refs/tags/v'
export CERT_OIDC_ISSUER='https://token.actions.githubusercontent.com'
```

If `cosign verify` ever reports an identity that does NOT match this
regex, **stop and do not install** - the binary was signed by some other
workflow and that is a red flag.

---

## 1. Verify a binary release (`.tar.gz` / `.zip`)

vaultctl signs `checksums.txt` (which lists the SHA-256 of every binary
archive) rather than each archive individually. To verify a binary you
verify the checksums file once, then match the archive's hash.

```sh
VERSION=v1.2.0   # replace with the tag you are installing
BASE="https://github.com/vineethkrishnan/vaultctl/releases/download/${VERSION}"

# 1. Download the checksums file + its cosign signature + certificate
curl -sSfLO "${BASE}/checksums.txt"
curl -sSfLO "${BASE}/checksums.txt.sig"
curl -sSfLO "${BASE}/checksums.txt.pem"

# 2. Verify the signature's certificate identity chain (keyless)
cosign verify-blob \
  --certificate checksums.txt.pem \
  --signature   checksums.txt.sig \
  --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
  --certificate-oidc-issuer     "${CERT_OIDC_ISSUER}" \
  checksums.txt
# expected: "Verified OK"

# 3. Download the archive you want (example: linux amd64)
curl -sSfLO "${BASE}/vaultctl_Linux_x86_64.tar.gz"

# 4. Match its SHA-256 against the verified checksums file
sha256sum --check --ignore-missing checksums.txt
# expected: vaultctl_Linux_x86_64.tar.gz: OK

# 5. Only now extract and install
tar xzf vaultctl_Linux_x86_64.tar.gz
./vaultctl --version
```

If **any** step fails, delete the downloaded files and do not use them.

---

## 2. Verify a container image

vaultctl signs the multi-arch image manifests on both GHCR and Docker Hub.

```sh
VERSION=v1.2.0

# GHCR (primary)
cosign verify \
  --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
  --certificate-oidc-issuer     "${CERT_OIDC_ISSUER}" \
  "ghcr.io/vineethkrishnan/vaultctl:${VERSION}"

# Docker Hub (mirror)
cosign verify \
  --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
  --certificate-oidc-issuer     "${CERT_OIDC_ISSUER}" \
  "docker.io/vineethnkrishnan/vaultctl:${VERSION}"
```

`cosign verify` exits 0 and prints a JSON bundle (certificate subject,
Rekor entry, bundle verified). Exit non-zero means **do not run the image**.

### Always pull by digest, not tag

After a successful verify, extract and pin the digest so a later tag
re-push cannot swap the image under you:

```sh
DIGEST=$(cosign verify \
  --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
  --certificate-oidc-issuer     "${CERT_OIDC_ISSUER}" \
  "ghcr.io/vineethkrishnan/vaultctl:${VERSION}" 2>/dev/null \
  | jq -r '.[0].critical.image."docker-manifest-digest"')
echo "${DIGEST}"   # sha256:...

docker pull "ghcr.io/vineethkrishnan/vaultctl@${DIGEST}"
```

Reference images by digest in `docker-compose.yml` / Kubernetes manifests
for production.

---

## 3. Verify SLSA build provenance (high-assurance)

Each release carries a SLSA L3 provenance attestation produced by
`actions/attest-build-provenance@v4`. It proves which workflow file at
which commit built the artifact.

```sh
VERSION=v1.2.0

# Container image provenance
gh attestation verify \
  oci://ghcr.io/vineethkrishnan/vaultctl:${VERSION} \
  --owner vineethkrishnan \
  --predicate-type https://slsa.dev/provenance/v1

# Or with cosign directly (binary archive)
cosign verify-attestation \
  --type slsaprovenance1 \
  --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
  --certificate-oidc-issuer     "${CERT_OIDC_ISSUER}" \
  "ghcr.io/vineethkrishnan/vaultctl:${VERSION}"
```

The provenance predicate tells you the exact commit SHA, the workflow
invocation, and the build parameters. If anything looks off (a commit you
didn't expect, a different workflow file), reject the release.

> **Note:** SLSA provenance is only published for releases cut from a
> public repository (`actions/attest-build-provenance` requires
> `id-token: write` with a public subject). If the repo is temporarily
> private for a release, the attestation step is skipped; cosign blob
> and image signatures still apply.

---

## 4. Download the SBOM

Every release archive ships a CycloneDX JSON SBOM next to it:

```sh
VERSION=v1.2.0
BASE="https://github.com/vineethkrishnan/vaultctl/releases/download/${VERSION}"

curl -sSfLO "${BASE}/vaultctl_Linux_x86_64.tar.gz.sbom.cdx.json"
```

Feed it into your vuln scanner or license-compliance tool. Examples:

```sh
# Grype - known-CVE scan
grype sbom:./vaultctl_Linux_x86_64.tar.gz.sbom.cdx.json

# Dependency-Track / FOSSA - upload the .cdx.json to your instance
```

---

## What if verification fails?

Any failure at any layer is a hard stop:

1. **Do not install the artifact.** Quarantine or delete it.
2. **Check <https://github.com/vineethkrishnan/vaultctl/security/advisories>**
   for active compromise notices.
3. **Open a security advisory draft** on that page describing what you
   observed. Maintainers are notified.
4. **Do not re-try the download from a mirror** - use the canonical
   GitHub Releases URL and re-verify. A mirror cannot fix an identity
   mismatch.

Signature verification is your single best defence against a stolen
registry credential or a compromised maintainer laptop. Treat it as
load-bearing, not ceremonial.

---

## Automating verification in CI

Put verification on the deploy path so a missed step can never ship:

```yaml
# .github/workflows/deploy.yml (example)
- uses: sigstore/cosign-installer@v3

- name: verify vaultctl image before deploy
  env:
    CERT_IDENTITY_REGEX: '^https://github\.com/vineethkrishnan/vaultctl/\.github/workflows/release\.yml@refs/tags/v'
    CERT_OIDC_ISSUER:    'https://token.actions.githubusercontent.com'
    VERSION: v1.2.0
  run: |
    cosign verify \
      --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
      --certificate-oidc-issuer     "${CERT_OIDC_ISSUER}" \
      "ghcr.io/vineethkrishnan/vaultctl:${VERSION}"
```

Fail-closed: if cosign errors, the deploy step fails, nothing ships.

---

## Related docs

- `.goreleaser.yaml` - the build + sign configuration being verified
- `.github/workflows/release.yml` - the workflow whose OIDC identity is
  baked into every certificate
