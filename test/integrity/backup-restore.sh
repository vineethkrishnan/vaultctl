#!/usr/bin/env bash
#
# backup-restore.sh — M15 backup/restore integrity check.
#
# Verifies that vaultctl's backup artefact round-trips cleanly:
#   1. Seed a source database with deterministic test data
#   2. Record a per-table row-count fingerprint
#   3. Run `vaultctl backup` against the source
#   4. Provision a fresh destination database
#   5. Restore the dump into the destination via `pg_restore`
#   6. Record the destination fingerprint
#   7. Diff the two fingerprints — any divergence fails the job
#
# All inputs come from environment variables; no user-supplied strings
# reach any run: line in the workflow that invokes this script.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config — CI overrides via env; local defaults point at localhost docker pg.
# ---------------------------------------------------------------------------

SRC_HOST="${SRC_HOST:-localhost}"
SRC_PORT="${SRC_PORT:-5432}"
SRC_USER="${SRC_USER:-vaultctl}"
SRC_PASSWORD="${SRC_PASSWORD:-vaultctl}"
SRC_DB="${SRC_DB:-vaultctl}"

DST_HOST="${DST_HOST:-$SRC_HOST}"
DST_PORT="${DST_PORT:-$SRC_PORT}"
DST_USER="${DST_USER:-$SRC_USER}"
DST_PASSWORD="${DST_PASSWORD:-$SRC_PASSWORD}"
DST_DB="${DST_DB:-vaultctl_restore}"

WORK_DIR="${WORK_DIR:-$(mktemp -d -t vaultctl-integrity-XXXXXX)}"
BACKUP_DIR="$WORK_DIR/backups"
mkdir -p "$BACKUP_DIR"

export PGPASSWORD="$SRC_PASSWORD"
PSQL_SRC=(psql -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" -v ON_ERROR_STOP=1 -A -t)
PSQL_DST=(psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$DST_DB" -v ON_ERROR_STOP=1 -A -t)

log() { printf '[integrity] %s\n' "$*" >&2; }
die() { log "FAIL: $*"; exit 1; }

cleanup() {
  log "cleanup: dropping restore db + work dir"
  PGPASSWORD="$DST_PASSWORD" psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d postgres \
    -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${DST_DB};" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Step 1 — seed the source database with deterministic test data
# ---------------------------------------------------------------------------

log "seeding source db ${SRC_DB} at ${SRC_HOST}:${SRC_PORT}"
"${PSQL_SRC[@]}" <<'SQL'
-- Create a test user, org, vault, and a handful of items so the dump has
-- real rows in each of the schema's major tables. Values are hardcoded
-- (no user input) so the fingerprint is reproducible.
INSERT INTO users (id, email, password_hash, name, role, created_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'integrity@example.invalid',
        'seed-hash', 'Integrity Test', 'owner', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, created_by, created_at)
VALUES ('22222222-2222-2222-2222-222222222222', 'integrity-org',
        '11111111-1111-1111-1111-111111111111', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO org_members (org_id, user_id, role, invited_at, accepted_at)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'owner', NOW(), NOW())
ON CONFLICT (org_id, user_id) DO NOTHING;

INSERT INTO vaults (id, name, type, org_id, created_by, created_at, updated_at)
VALUES ('33333333-3333-3333-3333-333333333333', 'integrity-vault',
        'shared', '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO vault_members (vault_id, user_id, encrypted_vault_key,
                           wrap_sender_id, wrap_signature, role, added_at)
VALUES ('33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111',
        'c2VlZA==',
        '11111111-1111-1111-1111-111111111111',
        'c2lnbmF0dXJl', 'owner', NOW())
ON CONFLICT (vault_id, user_id) DO NOTHING;

INSERT INTO vault_items (id, vault_id, item_type, encrypted_data, encrypted_name,
                         favorite, reprompt, created_at, updated_at)
SELECT
  gen_random_uuid(),
  '33333333-3333-3333-3333-333333333333',
  'login',
  decode('c2VlZA==', 'base64'),
  decode('c2VlZA==', 'base64'),
  false, false, NOW(), NOW()
FROM generate_series(1, 10);
SQL

# ---------------------------------------------------------------------------
# Step 2 — capture source fingerprint
# ---------------------------------------------------------------------------

fingerprint() {
  local -a psql=("$@")
  "${psql[@]}" <<'SQL' | sort
SELECT table_name || ':' || (xpath('/row/c/text()',
       query_to_xml(format('SELECT count(*) AS c FROM %I', table_name),
                    true, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name NOT LIKE 'schema_migrations%';
SQL
}

log "capturing source fingerprint"
SRC_FP="$WORK_DIR/src.fp"
fingerprint "${PSQL_SRC[@]}" > "$SRC_FP"
log "source fingerprint:"
cat "$SRC_FP" >&2

# ---------------------------------------------------------------------------
# Step 3 — run vaultctl backup
# ---------------------------------------------------------------------------

if [ -z "${VAULTCTL_BIN:-}" ]; then
  die "VAULTCTL_BIN must point to the vaultctl binary"
fi

log "running ${VAULTCTL_BIN} backup --output ${BACKUP_DIR}"
"$VAULTCTL_BIN" backup --output "$BACKUP_DIR"

DUMP_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name 'vaultctl-*.dump' -type f | head -n1)
if [ -z "$DUMP_FILE" ]; then
  die "backup did not produce a vaultctl-*.dump file under ${BACKUP_DIR}"
fi
log "backup produced $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

# ---------------------------------------------------------------------------
# Step 4 — provision destination database
# ---------------------------------------------------------------------------

log "creating destination db ${DST_DB}"
PGPASSWORD="$DST_PASSWORD" psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d postgres \
  -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DST_DB};"

# ---------------------------------------------------------------------------
# Step 5 — restore dump into destination
# ---------------------------------------------------------------------------

log "restoring ${DUMP_FILE} into ${DST_DB}"
PGPASSWORD="$DST_PASSWORD" pg_restore \
  -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$DST_DB" \
  --no-owner --no-privileges --exit-on-error \
  "$DUMP_FILE"

# ---------------------------------------------------------------------------
# Step 6 — capture destination fingerprint
# ---------------------------------------------------------------------------

log "capturing destination fingerprint"
DST_FP="$WORK_DIR/dst.fp"
PGPASSWORD="$DST_PASSWORD" \
  fingerprint psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$DST_DB" -v ON_ERROR_STOP=1 -A -t > "$DST_FP"
log "destination fingerprint:"
cat "$DST_FP" >&2

# ---------------------------------------------------------------------------
# Step 7 — diff
# ---------------------------------------------------------------------------

if ! diff -u "$SRC_FP" "$DST_FP"; then
  die "fingerprint mismatch — backup/restore lost or mutated rows"
fi

log "OK: source and destination row counts match across every table"
