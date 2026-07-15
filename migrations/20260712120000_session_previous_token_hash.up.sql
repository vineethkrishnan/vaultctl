-- Refresh-token reuse detection (security M1). On rotation the superseded hash
-- is retained here so that a replay of a just-rotated token is recognised as
-- theft rather than silently missing. Nullable + additive: existing rows keep
-- NULL until their next rotation.
ALTER TABLE sessions
    ADD COLUMN previous_token_hash BYTEA;

CREATE INDEX idx_sessions_previous_token_hash
    ON sessions (previous_token_hash)
    WHERE previous_token_hash IS NOT NULL;
