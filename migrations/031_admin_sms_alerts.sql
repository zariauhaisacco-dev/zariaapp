-- ============================================================
-- Zaria — Migration 031: Admin SMS alerts config
-- 2026-10-21
-- ============================================================

INSERT IGNORE INTO `app_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('admin_alert_phone', '', 'Admin phone for SMS alerts (2547XXXXXXXX)'),
  ('admin_sms_alerts_enabled', '1', 'Enable SMS alerts to admin on new signup / loan request');
