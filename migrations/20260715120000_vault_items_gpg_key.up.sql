-- Allow the gpg_key item type. item_type is a VARCHAR gated by a CHECK
-- allowlist rather than a Postgres enum, so widening it means recreating the
-- constraint. Additive: no existing row changes and no data is touched.
ALTER TABLE vault_items
    DROP CONSTRAINT vault_items_type_chk;

ALTER TABLE vault_items
    ADD CONSTRAINT vault_items_type_chk CHECK (
        item_type IN ('login','secure_note','credit_card','identity','api_key','ssh_key','passkey','gpg_key')
    );
