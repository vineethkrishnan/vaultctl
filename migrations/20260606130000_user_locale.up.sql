-- Per-user UI/email locale. Selects the language for transactional email.
-- Defaults to 'en' so existing users keep receiving English mail.
ALTER TABLE users
    ADD COLUMN locale VARCHAR(8) NOT NULL DEFAULT 'en';

ALTER TABLE users
    ADD CONSTRAINT users_locale_chk CHECK (locale IN ('en','de'));
