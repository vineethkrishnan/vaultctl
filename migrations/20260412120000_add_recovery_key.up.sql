-- Add column for the recovery-wrapped private key (M12 recovery kit).
-- This is AES-GCM(recoveryKey, privateKey) — encrypted with the recovery
-- key, NOT the stretched master password. Stored so the server can return
-- it during account recovery without knowing the forgotten master password.
ALTER TABLE users ADD COLUMN recovery_encrypted_private_key TEXT;
