-- Email verification: track whether a user's email is confirmed, and hold the
-- one active one-time code per user (resend overwrites). Codes are stored as an
-- HMAC digest (server pepper), never in cleartext.

ALTER TABLE users
    ADD COLUMN email_verified    BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN email_verified_at TIMESTAMPTZ;

CREATE TABLE email_verifications (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_hash  BYTEA       NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts   INT         NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
