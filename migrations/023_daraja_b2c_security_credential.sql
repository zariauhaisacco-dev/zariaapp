-- 023_daraja_b2c_security_credential.sql
-- Store the pre-computed B2C SecurityCredential in app_settings.
--
-- The SecurityCredential is an RSA-encrypted form of the initiator password,
-- produced by Safaricom. Storing it encrypted at rest lets the admin paste
-- it once via the UI, and the B2C service reads it at runtime.

INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES
  ('daraja_b2c_security_credential_enc', '', 'B2C SecurityCredential (AES-256-GCM encrypted, base64)');
