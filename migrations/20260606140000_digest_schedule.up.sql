-- Per-user timezone (IANA name, e.g. 'Europe/Berlin') used to interpret the
-- digest schedule. Defaults to 'UTC' so existing users keep UTC-based timing.
ALTER TABLE users
    ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';

-- Granular digest schedule. All nullable; only the fields relevant to the
-- chosen frequency are set:
--   daily     -> sched_hour, sched_minute
--   weekly    -> sched_weekday, sched_hour, sched_minute
--   monthly   -> sched_day, sched_hour, sched_minute
--   quarterly -> sched_day, sched_hour, sched_minute (every 3 months)
--   yearly    -> sched_month, sched_day, sched_hour, sched_minute
-- When all are NULL the legacy generic next-run is used (backward compatible).
ALTER TABLE user_digest_prefs
    ADD COLUMN sched_hour    SMALLINT,
    ADD COLUMN sched_minute  SMALLINT,
    ADD COLUMN sched_weekday SMALLINT,
    ADD COLUMN sched_day     SMALLINT,
    ADD COLUMN sched_month   SMALLINT;

ALTER TABLE user_digest_prefs
    ADD CONSTRAINT user_digest_sched_hour_chk    CHECK (sched_hour    IS NULL OR sched_hour    BETWEEN 0 AND 23),
    ADD CONSTRAINT user_digest_sched_minute_chk  CHECK (sched_minute  IS NULL OR sched_minute  BETWEEN 0 AND 59),
    ADD CONSTRAINT user_digest_sched_weekday_chk CHECK (sched_weekday IS NULL OR sched_weekday BETWEEN 0 AND 6),
    ADD CONSTRAINT user_digest_sched_day_chk     CHECK (sched_day     IS NULL OR sched_day     BETWEEN 1 AND 31),
    ADD CONSTRAINT user_digest_sched_month_chk   CHECK (sched_month   IS NULL OR sched_month   BETWEEN 1 AND 12);
