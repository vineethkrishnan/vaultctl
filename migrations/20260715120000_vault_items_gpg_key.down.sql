-- Narrow vault_items_type_chk back to the pre-gpg_key allowlist.
--
-- Rolling the SERVER back does not require this migration: widening a CHECK is
-- additive, and an older binary reads existing gpg_key rows fine (item types are
-- only validated on write). This is break-glass, for genuinely reverting the
-- schema.
--
-- It refuses to run while any gpg_key item exists rather than deleting or
-- silently retyping it. Those rows hold private key material the user may have
-- no other copy of, and a rollback is not a mandate to destroy them. Resolve
-- the rows deliberately (export them, or retype them) and re-run.
--
-- Without this guard the rollback would fail anyway, on an opaque check-constraint
-- violation naming no cause; the RAISE just makes the reason legible.
--
-- Either way the failure leaves golang-migrate's schema_migrations dirty, as any
-- failed migration does, and the CLI exposes only up/down - no force. The schema
-- and data are untouched; clear the flag by hand before retrying:
--   UPDATE schema_migrations SET dirty=false, version=20260715120000;
DO $$
DECLARE
    remaining BIGINT;
BEGIN
    SELECT count(*) INTO remaining FROM vault_items WHERE item_type = 'gpg_key';
    IF remaining > 0 THEN
        RAISE EXCEPTION
            'refusing to roll back: % gpg_key item(s) still exist. Export or retype them first; rolling back would leave rows the CHECK constraint cannot represent.',
            remaining;
    END IF;
END $$;

ALTER TABLE vault_items
    DROP CONSTRAINT vault_items_type_chk;

ALTER TABLE vault_items
    ADD CONSTRAINT vault_items_type_chk CHECK (
        item_type IN ('login','secure_note','credit_card','identity','api_key','ssh_key','passkey')
    );
