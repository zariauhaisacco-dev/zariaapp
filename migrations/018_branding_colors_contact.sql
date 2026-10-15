-- 018_branding_colors_contact.sql
-- Extends branding with configurable colors and contact information.
--
-- Colors are 6-digit hex (#RRGGBB). Contact fields are free-form strings.
-- All values are read by GET /api/branding and shown on the landing page.

INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES
  ('color_primary',    '#0B1F3A',                'Primary brand color (hex)'),
  ('color_accent',     '#F5B301',                'Accent / CTA color (hex)'),
  ('color_background', '#F8F7F5',                'Landing page background (hex)'),
  ('contact_phone',    '0746 138 896',           'Contact phone displayed on the landing page'),
  ('contact_whatsapp', '254746138896',           'WhatsApp number (digits only, no + sign)'),
  ('contact_email',    'info@zariauhai.com',     'Contact email on the landing page'),
  ('contact_location', 'Nairobi, Kenya',         'Physical location line'),
  ('contact_hours',    'Mon–Sat, 8:00–18:00 EAT','Business hours');
