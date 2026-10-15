-- 017_branding.sql
-- Adds branding settings so the landing page and app chrome can be
-- customised by the admin without a code change.
--
-- Values stored in app_settings (key/value). Read by GET /api/branding.

INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES
  ('sacco_name',   'Zaria Uhai SACCO',   'Full SACCO name shown on landing page and app'),
  ('tagline',      'Save together. Grow together.', 'Short tagline for the landing hero'),
  ('logo_url',     'logo.png',           'Path to logo (relative to /public). Empty = no logo.'),
  ('mission_short','Inclusive savings, affordable credit, and member-centered support.', 'Short mission for the landing page'),
  ('vision',       'An inclusive and self-sustaining community where every member has the opportunity to save, access affordable finance and build a secure livelihood.', 'Vision statement for the landing page');
