-- Per-user opt-out for new-device/new-network sign-in alert emails. Defaults
-- to true so existing users keep receiving alerts until they turn them off.
ALTER TABLE user_digest_prefs
    ADD COLUMN login_alerts BOOLEAN NOT NULL DEFAULT TRUE;
