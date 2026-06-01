-- Per-user backup destinations and the history of runs against them.
-- The vault export itself stays client-side-encrypted (the server only ever
-- handles ciphertext); provider credentials are sealed with the server data
-- key before they land in encrypted_config.

CREATE TABLE backup_destinations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          VARCHAR(32) NOT NULL,           -- local | s3 | webdav | gdrive | dropbox | onedrive
    label             TEXT NOT NULL,
    encrypted_config  TEXT NOT NULL,                  -- v1|AES-GCM sealed JSON of provider settings + tokens
    frequency         VARCHAR(16) NOT NULL,           -- off | daily | weekly
    retention_keep    INT NOT NULL DEFAULT 7,
    enabled           BOOLEAN NOT NULL DEFAULT true,
    last_run_at       TIMESTAMPTZ,
    last_status       VARCHAR(16),                    -- success | failed (null until first run)
    next_run_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX backup_destinations_user_id_idx ON backup_destinations (user_id);
-- The scheduler scans for enabled destinations whose next_run_at is due.
CREATE INDEX backup_destinations_due_idx
    ON backup_destinations (next_run_at)
    WHERE enabled AND frequency <> 'off';

CREATE TABLE backup_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    destination_id  UUID NOT NULL REFERENCES backup_destinations(id) ON DELETE CASCADE,
    status          VARCHAR(16) NOT NULL,             -- success | failed
    trigger         VARCHAR(16) NOT NULL,             -- scheduled | manual
    artifact_name   TEXT,
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    error           TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

CREATE INDEX backup_runs_destination_id_idx ON backup_runs (destination_id, started_at DESC);
