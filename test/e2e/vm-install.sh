#!/usr/bin/env bash
# vaultctl end-to-end self-host install test.
#
# Run inside a fresh Linux host with docker + docker compose installed (or
# a Lima VM created via `limactl start template://docker-rootful`). The
# script drives the exact flow a new operator would follow per README.md:
#
#   1. cd into a vaultctl checkout
#   2. cp .env.example .env and fill in real secrets
#   3. docker build the image locally (necessary while the public registry
#      images aren't pullable — see release-readiness notes)
#   4. docker compose -f docker-compose.simple.yml up -d
#   5. docker compose exec vaultctl /usr/local/bin/vaultctl migrate up
#   6. POST /auth/register with no invite token -> 201 + role=owner
#      (the first-user bypass: zero users means the first registration
#      becomes owner regardless of VAULTCTL_REGISTRATION_MODE)
#   7. POST /auth/register again -> 400 INVITE_REQUIRED
#
# Exits 0 on pass, non-zero on any failure.
#
# Usage:
#   bash test/e2e/vm-install.sh [SRC_DIR]
#   SRC_DIR defaults to the script's repo root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${1:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
cd "$SRC_DIR"

log() { printf '\n=== %s ===\n' "$*"; }

log "1. Sanity"
docker --version
docker compose version

log "2. Generate secrets and write .env"
cp .env.example .env
DEK=$(openssl rand -base64 32)
SP=$(openssl rand -base64 32)
EP=$(openssl rand -base64 32)
JWT=$(openssl rand -base64 64 | tr -d '\n')
DBP=$(openssl rand -hex 16)
sed -i \
  -e "s|^VAULTCTL_DB_PASSWORD=.*|VAULTCTL_DB_PASSWORD=${DBP}|" \
  -e "s|^VAULTCTL_JWT_SECRET_CURRENT=.*|VAULTCTL_JWT_SECRET_CURRENT=${JWT}|" \
  -e "s|^VAULTCTL_DATA_ENCRYPTION_KEY=.*|VAULTCTL_DATA_ENCRYPTION_KEY=${DEK}|" \
  -e "s|^VAULTCTL_SERVER_PEPPER=.*|VAULTCTL_SERVER_PEPPER=${SP}|" \
  -e "s|^VAULTCTL_ENUMERATION_PEPPER=.*|VAULTCTL_ENUMERATION_PEPPER=${EP}|" \
  -e "s|^VAULTCTL_BASE_URL=.*|VAULTCTL_BASE_URL=http://localhost:8080|" \
  .env

log "3. Build the vaultctl image locally"
IMAGE_TAG="ghcr.io/vineethkrishnan/vaultctl:latest"
docker build -t "$IMAGE_TAG" --build-arg VERSION=e2e --build-arg COMMIT=e2e .

log "4. Bring up the stack (simple compose, no Caddy)"
docker compose -f docker-compose.simple.yml up -d
for i in {1..30}; do
  if docker compose -f docker-compose.simple.yml ps vaultctl-db --format '{{.Health}}' | grep -q healthy; then
    echo "  postgres healthy"
    break
  fi
  sleep 1
done

log "5. Apply migrations"
docker compose -f docker-compose.simple.yml exec -T vaultctl /usr/local/bin/vaultctl migrate up

log "6. Wait for API to be reachable"
for i in {1..30}; do
  if curl -sf -o /dev/null http://127.0.0.1:8080/api/v1/health; then
    echo "  API up"
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8080/api/v1/health

log "7. First registration (no invite token) -- expect 201 + role=owner"
HEX_AUTH=$(python3 -c "print('42'*32)")
HEX_SALT=$(python3 -c "print('5A'*16)")
HEX_PUB=$(python3 -c "print('11'*32)")
HEX_SIG=$(python3 -c "print('22'*64)")
HEX_BLOB="0101$(python3 -c "print('A1'*12)")78$(python3 -c "print('B2'*16)")"

BODY=$(python3 - <<EOF
import base64, json
def b64h(h): return base64.b64encode(bytes.fromhex(h)).decode()
body = {
    "email": "first@example.com",
    "name": "Test User",
    "authHash": b64h("$HEX_AUTH"),
    "salt": b64h("$HEX_SALT"),
    "masterPasswordPreflight": "Correct-horse-8&!",
    "kdfIterations": 3,
    "kdfMemoryKB": 65536,
    "kdfParallelism": 4,
    "encryptedPrivateKey": b64h("$HEX_BLOB"),
    "encryptedIdentityPrivateKey": b64h("$HEX_BLOB"),
    "publicKey": b64h("$HEX_PUB"),
    "publicKeySignature": b64h("$HEX_SIG"),
    "identityPublicKey": b64h("$HEX_PUB"),
    "inviteToken": "",
}
print(json.dumps(body))
EOF
)

RESP=$(curl -sS -o /tmp/r1.json -w "%{http_code}" -X POST http://127.0.0.1:8080/api/v1/auth/register \
  -H 'Content-Type: application/json' -d "$BODY")
echo "  http=$RESP body=$(cat /tmp/r1.json)"
test "$RESP" = "201" || { echo "FAIL: expected 201, got $RESP"; exit 1; }
ROLE=$(python3 -c "import json; print(json.load(open('/tmp/r1.json'))['role'])")
test "$ROLE" = "owner" || { echo "FAIL: expected role=owner, got '$ROLE'"; exit 1; }

log "8. Second registration (no invite token) -- expect 4xx INVITE_REQUIRED"
BODY2=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); d['email']='second@example.com'; print(json.dumps(d))")
RESP=$(curl -sS -o /tmp/r2.json -w "%{http_code}" -X POST http://127.0.0.1:8080/api/v1/auth/register \
  -H 'Content-Type: application/json' -d "$BODY2")
echo "  http=$RESP body=$(cat /tmp/r2.json)"
test "$RESP" != "201" || { echo "FAIL: second registration should be rejected"; exit 1; }
grep -q INVITE_REQUIRED /tmp/r2.json || { echo "FAIL: expected INVITE_REQUIRED error code"; exit 1; }

log "PASS -- first-user bypass works end-to-end in a fresh install"
