-- Attachments: encrypted file attachments for vault items.
--
-- The ciphertext bytes live in the filesystem blob store (not Postgres). This
-- table holds only metadata plus the per-attachment file key wrapped by the
-- vault key, so the server stores no plaintext (zero-knowledge).
CREATE TABLE attachments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id             UUID NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
    vault_id            UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    storage_key         VARCHAR(128) NOT NULL UNIQUE,        -- opaque blob-store key
    encrypted_filename  TEXT NOT NULL,                       -- v1|AES-GCM blob
    wrapped_file_key    TEXT NOT NULL,                       -- per-attachment key wrapped by the vault key
    ciphertext_size     BIGINT NOT NULL,
    ciphertext_sha256   BYTEA NOT NULL,                      -- at-rest integrity check
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX attachments_item_id_idx ON attachments (item_id);
CREATE INDEX attachments_vault_id_idx ON attachments (vault_id);
