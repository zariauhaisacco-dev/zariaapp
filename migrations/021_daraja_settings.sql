-- 021_daraja_settings.sql
-- Store Daraja (M-Pesa) credentials in app_settings so admins can update
-- them via the UI without editing .env or restarting.
--
-- Sensitive fields are stored AES-256-GCM encrypted with a key held only in
-- the .env file (APP_ENCRYPTION_KEY). Values are base64(iv||tag||ciphertext).
--
-- Precedence: DB settings override env vars. Env vars are only used if the
-- DB has no value — that way a fresh install can bootstrap from .env, but
-- once admin saves via UI, DB is authoritative.

INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES
  ('daraja_env',                 'sandbox',   'Daraja environment: sandbox or production'),
  ('daraja_shortcode',           '',          'Business shortcode (Paybill / Till)'),
  ('daraja_consumer_key',        '',          'Daraja consumer key (public part)'),
  ('daraja_consumer_secret_enc', '',          'Daraja consumer secret (AES-256-GCM encrypted, base64)'),
  ('daraja_passkey_enc',         '',          'Daraja STK passkey (AES-256-GCM encrypted, base64)'),
  ('daraja_callback_url',        'https://zariauhai.com/api/daraja/callback', 'Public callback URL for STK Push results'),
  ('daraja_b2c_shortcode',       '',          'B2C shortcode (usually same as Paybill)'),
  ('daraja_b2c_initiator_name',  '',          'B2C initiator name'),
  ('daraja_b2c_initiator_pass_enc', '',       'B2C initiator password (AES-256-GCM encrypted, base64)');
