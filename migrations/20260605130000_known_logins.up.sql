-- Known logins: a per-user record of (device fingerprint, network) pairs seen
-- before, so a genuinely new device or network can raise a one-time alert.
-- fingerprint is an HMAC of the coarse device label (browser + OS family), not
-- the raw user-agent, so routine version bumps do not look like a new device.
-- network is the already-anonymised client IP.

CREATE TABLE known_logins (
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fingerprint  BYTEA       NOT NULL,
    network      TEXT        NOT NULL DEFAULT '',
    label        TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, fingerprint, network)
);
