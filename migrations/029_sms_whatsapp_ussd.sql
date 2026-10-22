-- ============================================================
-- Zaria — Migration 029: SMS + WhatsApp + USSD (Ping Africa)
-- 2026-10-21
--
-- Adds:
--   - sms_logs, whatsapp_logs, ussd_sessions tables
--   - clients: sms_opt_out, whatsapp_opt_in, ussd_enabled
--   - app_settings: ping_* config rows
--
-- Idempotent: guards each ALTER/INSERT.
-- Rollback: see bottom of file.
-- ============================================================

-- ---- 1. sms_logs ---------------------------------------------
CREATE TABLE IF NOT EXISTS `sms_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` BIGINT UNSIGNED NULL,
  `phone` VARCHAR(20) NOT NULL,
  `message` TEXT NOT NULL,
  `template` VARCHAR(50) NULL,
  `status` ENUM('pending','sent','delivered','failed') NOT NULL DEFAULT 'pending',
  `provider_message_id` VARCHAR(100) NULL,
  `transaction_reference` VARCHAR(100) NULL,
  `credits_charged` DECIMAL(10,4) NULL,
  `parts` INT NOT NULL DEFAULT 1,
  `error_message` VARCHAR(500) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivered_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_client` (`client_id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_template` (`template`),
  CONSTRAINT `sms_logs_client_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 2. whatsapp_logs ----------------------------------------
CREATE TABLE IF NOT EXISTS `whatsapp_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` BIGINT UNSIGNED NULL,
  `phone` VARCHAR(20) NOT NULL,
  `message_type` ENUM('text','image','document','video','audio') NOT NULL DEFAULT 'text',
  `text_content` TEXT NULL,
  `media_url` VARCHAR(500) NULL,
  `media_caption` VARCHAR(200) NULL,
  `media_filename` VARCHAR(200) NULL,
  `template` VARCHAR(50) NULL,
  `status` ENUM('pending','sent','delivered','failed') NOT NULL DEFAULT 'pending',
  `provider_message_id` VARCHAR(100) NULL,
  `error_message` VARCHAR(500) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivered_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_client` (`client_id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `wa_logs_client_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 3. ussd_sessions ----------------------------------------
CREATE TABLE IF NOT EXISTS `ussd_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `service_code` VARCHAR(50) NOT NULL,
  `client_id` BIGINT UNSIGNED NULL,
  `state` VARCHAR(50) NOT NULL DEFAULT 'menu',
  `last_input` VARCHAR(10) NULL,
  `last_response` TEXT NULL,
  `started_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `ended_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_session` (`session_id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_started` (`started_at`),
  KEY `client_id` (`client_id`),
  CONSTRAINT `ussd_client_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 4. clients opt-in/out columns ---------------------------
SET @has_sms := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'sms_opt_out');
SET @sql := IF(@has_sms = 0,
  'ALTER TABLE `clients` ADD COLUMN `sms_opt_out` TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT "clients.sms_opt_out already exists" AS msg');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_wa := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'whatsapp_opt_in');
SET @sql2 := IF(@has_wa = 0,
  'ALTER TABLE `clients` ADD COLUMN `whatsapp_opt_in` TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT "clients.whatsapp_opt_in already exists" AS msg');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @has_ussd := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'ussd_enabled');
SET @sql3 := IF(@has_ussd = 0,
  'ALTER TABLE `clients` ADD COLUMN `ussd_enabled` TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT "clients.ussd_enabled already exists" AS msg');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ---- 5. app_settings ----------------------------------------
INSERT IGNORE INTO `app_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('ping_enabled', '0', 'Ping Africa communication layer enabled (0=off, 1=on)'),
  ('ping_sender_id', 'PING-AFRICA', 'SMS sender ID'),
  ('ping_whatsapp_instance', '', 'Ping Africa WhatsApp instance name'),
  ('ping_ussd_code', '', 'USSD service code (e.g. *384*1234#)'),
  ('ping_daily_sms_limit', '10', 'Max SMS per client per day');

-- ============================================================
-- ROLLBACK — commented out. Do NOT run unless reverting.
-- ============================================================
-- DROP TABLE IF EXISTS `ussd_sessions`;
-- DROP TABLE IF EXISTS `whatsapp_logs`;
-- DROP TABLE IF EXISTS `sms_logs`;
-- ALTER TABLE `clients` DROP COLUMN `ussd_enabled`, DROP COLUMN `whatsapp_opt_in`, DROP COLUMN `sms_opt_out`;
-- DELETE FROM `app_settings` WHERE setting_key LIKE 'ping_%';
