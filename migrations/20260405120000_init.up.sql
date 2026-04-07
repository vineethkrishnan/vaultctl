-- vaultctl initial schema (M4)
-- Aligned with prd.md §9 and the security-review updates folded in at
-- architecture §13. Every encrypted column stores a versioned blob
-- (PRD §9.9 — C5).

-- uuid/gen_random_uuid comes from pgcrypto.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================================================================
-- 9.1 users
-- ===========================================================================

CREATE TABLE users (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                           VARCHAR(255) UNIQUE NOT NULL,
    name                            VARCHAR(255) NOT NULL,
    auth_hash                       VARCHAR(512) NOT NULL,       -- PHC-encoded Argon2id
    salt                            BYTEA NOT NULL,              -- per-user Argon2 salt (public)
    kdf_iterations                  INT NOT NULL DEFAULT 3,
    kdf_memory                      INT NOT NULL DEFAULT 65536,
    kdf_parallelism                 INT NOT NULL DEFAULT 4,
    encrypted_private_key           TEXT NOT NULL,               -- v1|AES-GCM blob
    public_key                      TEXT NOT NULL,               -- RSA-2048 bytes (plaintext)
    public_key_signature            TEXT NOT NULL,               -- C1 Ed25519 sig
    identity_public_key             TEXT NOT NULL,               -- C1 Ed25519 pubkey
    encrypted_identity_private_key  TEXT NOT NULL,               -- C1 v1|AES-GCM blob
    encrypted_password_hint         BYTEA,                       -- H4 server-encrypted
    totp_secret                     BYTEA,                       -- H5 server-encrypted
    totp_enabled                    BOOLEAN NOT NULL DEFAULT FALSE,
    totp_last_counter               BIGINT,                      -- H6 replay protection
    failed_login_attempts           INT NOT NULL DEFAULT 0,
    locked_until                    TIMESTAMPTZ,
    role                            VARCHAR(50) NOT NULL DEFAULT 'member',
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_role_chk CHECK (role IN ('owner','admin','member'))
);
CREATE INDEX idx_users_email ON users(email);

-- ===========================================================================
-- 9.5 organizations
-- ===========================================================================

CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE org_members (
    org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(50) NOT NULL DEFAULT 'member',
    invited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    PRIMARY KEY (org_id, user_id),
    CONSTRAINT org_members_role_chk CHECK (role IN ('owner','admin','member'))
);

-- Org invite tokens (M11)
CREATE TABLE org_invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_by  UUID NOT NULL REFERENCES users(id),
    email       VARCHAR(255) NOT NULL,
    token_hash  BYTEA UNIQUE NOT NULL,                   -- HMAC(server_pepper, raw_token)
    role        VARCHAR(50) NOT NULL DEFAULT 'member',
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT org_invites_role_chk CHECK (role IN ('owner','admin','member'))
);
CREATE INDEX idx_org_invites_token_hash ON org_invites(token_hash);
CREATE INDEX idx_org_invites_expires_at ON org_invites(expires_at);

-- ===========================================================================
-- 9.2 vaults + members
-- ===========================================================================

CREATE TABLE vaults (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(50) NOT NULL,
    org_id      UUID REFERENCES organizations(id),
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vaults_type_chk CHECK (type IN ('personal','shared')),
    CONSTRAINT vaults_personal_no_org CHECK (
        (type = 'personal' AND org_id IS NULL) OR
        (type = 'shared' AND org_id IS NOT NULL)
    )
);

CREATE TABLE vault_members (
    vault_id              UUID REFERENCES vaults(id) ON DELETE RESTRICT,  -- M3
    user_id               UUID REFERENCES users(id) ON DELETE RESTRICT,   -- M3
    encrypted_vault_key   TEXT NOT NULL,
    wrap_sender_id        UUID REFERENCES users(id),                     -- H1
    wrap_signature        TEXT NOT NULL,                                 -- H1
    role                  VARCHAR(50) NOT NULL DEFAULT 'member',
    added_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at            TIMESTAMPTZ,                                   -- M3 soft-delete
    PRIMARY KEY (vault_id, user_id),
    CONSTRAINT vault_members_role_chk CHECK (role IN ('owner','admin','member'))
);
CREATE INDEX idx_vault_members_user_active ON vault_members(user_id) WHERE removed_at IS NULL;

-- ===========================================================================
-- 9.4 folders
-- ===========================================================================

CREATE TABLE folders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id        UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    encrypted_name  TEXT NOT NULL,                       -- v1|AES-GCM blob + 32B padding (M5)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_folders_vault_id ON folders(vault_id);

-- ===========================================================================
-- 9.3 vault_items
-- ===========================================================================

CREATE TABLE vault_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_id        UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    folder_id       UUID REFERENCES folders(id) ON DELETE SET NULL,
    item_type       VARCHAR(50) NOT NULL,
    encrypted_data  TEXT NOT NULL,                       -- v1|AES-GCM blob (C5)
    encrypted_name  TEXT NOT NULL,                       -- v1|AES-GCM blob + 32B padding (M5)
    favorite        BOOLEAN NOT NULL DEFAULT FALSE,
    reprompt        BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vault_items_type_chk CHECK (
        item_type IN ('login','secure_note','credit_card','identity','api_key','ssh_key','passkey')
    )
);
CREATE INDEX idx_vault_items_vault_id ON vault_items(vault_id);
CREATE INDEX idx_vault_items_folder_id ON vault_items(folder_id);
CREATE INDEX idx_vault_items_active ON vault_items(vault_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vault_items_trash ON vault_items(deleted_at) WHERE deleted_at IS NOT NULL;

-- ===========================================================================
-- 9.6 sessions
-- ===========================================================================

CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  BYTEA UNIQUE NOT NULL,           -- C3 HMAC, never raw
    device_name         VARCHAR(255),
    ip_address          INET,                            -- M1 truncated per VAULTCTL_LOG_IP_PRECISION
    last_refresh_at     TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- ===========================================================================
-- 9.7 api_keys
-- ===========================================================================

CREATE TABLE api_keys (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    key_hash      BYTEA NOT NULL,                        -- H7 HMAC(pepper, key)
    key_prefix    VARCHAR(10) NOT NULL,
    last_used_at  TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

-- ===========================================================================
-- 9.8 audit_logs
-- ===========================================================================

CREATE TABLE audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    action        VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id   UUID,
    ip_address    INET,                                  -- M1 anonymised at write
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
