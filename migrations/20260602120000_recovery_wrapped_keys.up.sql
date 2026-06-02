-- Recovery-kit support: store each user's private keys a second time, wrapped
-- under the random 256-bit recovery key (never the master password). The
-- recovery flow returns these so the client can decrypt them with the recovery
-- key and re-wrap them under a fresh master password. Nullable because they are
-- only populated for accounts that have a recovery kit on file; pre-existing
-- accounts opt in by regenerating their kit from settings.
ALTER TABLE users ADD COLUMN encrypted_recovery_wrapped_private_key BYTEA;
ALTER TABLE users ADD COLUMN encrypted_recovery_wrapped_identity_private_key BYTEA;
