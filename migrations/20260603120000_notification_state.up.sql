-- Per-user read/clear state for the in-app notification centre. The feed
-- itself is derived from audit_logs (no duplicate event store); this table
-- only tracks how far a user has read and what they've cleared.
--   last_read_at: events at/before this timestamp are shown as "read".
--   cleared_at:   events at/before this timestamp are hidden from the feed.
CREATE TABLE user_notification_state (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ,
    cleared_at   TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
