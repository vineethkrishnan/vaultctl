-- Per-user activity-digest preference. frequency is one of off/daily/weekly/
-- monthly/quarterly/yearly. next_run_at is when the scheduler should next send;
-- NULL when off.

CREATE TABLE user_digest_prefs (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    frequency   TEXT        NOT NULL DEFAULT 'off',
    next_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_digest_freq_chk CHECK (
        frequency IN ('off','daily','weekly','monthly','quarterly','yearly')
    )
);

CREATE INDEX idx_user_digest_due ON user_digest_prefs(next_run_at)
    WHERE frequency <> 'off' AND next_run_at IS NOT NULL;
