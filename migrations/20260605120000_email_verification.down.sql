DROP TABLE IF EXISTS email_verifications;

ALTER TABLE users
    DROP COLUMN IF EXISTS email_verified_at,
    DROP COLUMN IF EXISTS email_verified;
