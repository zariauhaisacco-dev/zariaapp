-- 024_daraja_b2c_credentials.sql
-- Separate Daraja credentials for B2C.
--
-- Safaricom issues separate Daraja apps per product. The STK Push app and
-- the B2C app have different consumer keys and secrets. This migration adds
-- B2C-specific credentials that override the STK ones for B2C operations.
--
-- If these are empty, the B2C service falls back to the STK credentials
-- (existing behaviour) — useful for testing when both products are on one app.

INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES
  ('daraja_b2c_consumer_key', '', 'B2C consumer key (from B2C-enabled Daraja app)'),
  ('daraja_b2c_consumer_secret_enc', '', 'B2C consumer secret (AES-256-GCM encrypted)');
