ALTER TABLE user_digest_prefs DROP CONSTRAINT IF EXISTS user_digest_sched_hour_chk;
ALTER TABLE user_digest_prefs DROP CONSTRAINT IF EXISTS user_digest_sched_minute_chk;
ALTER TABLE user_digest_prefs DROP CONSTRAINT IF EXISTS user_digest_sched_weekday_chk;
ALTER TABLE user_digest_prefs DROP CONSTRAINT IF EXISTS user_digest_sched_day_chk;
ALTER TABLE user_digest_prefs DROP CONSTRAINT IF EXISTS user_digest_sched_month_chk;

ALTER TABLE user_digest_prefs
    DROP COLUMN IF EXISTS sched_hour,
    DROP COLUMN IF EXISTS sched_minute,
    DROP COLUMN IF EXISTS sched_weekday,
    DROP COLUMN IF EXISTS sched_day,
    DROP COLUMN IF EXISTS sched_month;

ALTER TABLE users DROP COLUMN IF EXISTS timezone;
