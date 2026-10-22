-- ============================================================
-- Zaria — Migration 028: Registration fee
-- 2026-10-20
--
-- Adds:
--   - app_settings: registration_fee, registration_fee_enabled
--   - clients: registration_fee_paid, registration_fee_amount, registration_fee_paid_at
--   - pending_registrations: registration_fee_snapshot
--   - daraja_requests: registration_fee_client_id
--   - registration_fees: dedicated fee-tracking table
--
-- Existing clients are grandfathered as "paid" (no fee owed retroactively).
-- New signups after enablement will be set to unpaid at approval.
--
-- Idempotent: guards each ALTER via information_schema.
-- Rollback: see bottom of file.
-- ============================================================

-- ---- 1. app_settings (guarded) --------------------------------
INSERT IGNORE INTO `app_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('registration_fee', '500', 'One-time registration fee amount (KES)'),
  ('registration_fee_enabled', '0', 'Whether new signups owe a registration fee (0=off, 1=on)');

-- ---- 2. clients.registration_fee_paid ------------------------
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'registration_fee_paid'
);
SET @sql := IF(@has_col = 0,
  'ALTER TABLE `clients` ADD COLUMN `registration_fee_paid` TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT "clients.registration_fee_paid already exists — skipped" AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 3. clients.registration_fee_amount ----------------------
SET @has_col2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'registration_fee_amount'
);
SET @sql2 := IF(@has_col2 = 0,
  'ALTER TABLE `clients` ADD COLUMN `registration_fee_amount` DECIMAL(15,2) NULL',
  'SELECT "clients.registration_fee_amount already exists — skipped" AS msg'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- ---- 4. clients.registration_fee_paid_at ---------------------
SET @has_col3 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'registration_fee_paid_at'
);
SET @sql3 := IF(@has_col3 = 0,
  'ALTER TABLE `clients` ADD COLUMN `registration_fee_paid_at` TIMESTAMP NULL DEFAULT NULL',
  'SELECT "clients.registration_fee_paid_at already exists — skipped" AS msg'
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

-- ---- 5. pending_registrations.registration_fee_snapshot -----
SET @has_col4 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pending_registrations' AND COLUMN_NAME = 'registration_fee_snapshot'
);
SET @sql4 := IF(@has_col4 = 0,
  'ALTER TABLE `pending_registrations` ADD COLUMN `registration_fee_snapshot` DECIMAL(15,2) NULL',
  'SELECT "pending_registrations.registration_fee_snapshot already exists — skipped" AS msg'
);
PREPARE stmt4 FROM @sql4; EXECUTE stmt4; DEALLOCATE PREPARE stmt4;

-- ---- 6. daraja_requests.registration_fee_client_id ----------
SET @has_col5 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daraja_requests' AND COLUMN_NAME = 'registration_fee_client_id'
);
SET @sql5 := IF(@has_col5 = 0,
  'ALTER TABLE `daraja_requests`
     ADD COLUMN `registration_fee_client_id` BIGINT UNSIGNED NULL,
     ADD KEY `idx_reg_fee_client` (`registration_fee_client_id`)',
  'SELECT "daraja_requests.registration_fee_client_id already exists — skipped" AS msg'
);
PREPARE stmt5 FROM @sql5; EXECUTE stmt5; DEALLOCATE PREPARE stmt5;

-- ---- 7. registration_fees table -----------------------------
CREATE TABLE IF NOT EXISTS `registration_fees` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` BIGINT UNSIGNED NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `channel` ENUM('cash','mpesa','bank','waived','system') NOT NULL,
  `mpesa_receipt` VARCHAR(50) NULL,
  `reference` VARCHAR(100) NULL,
  `notes` VARCHAR(500) NULL,
  `status` ENUM('paid','waived') NOT NULL DEFAULT 'paid',
  `recorded_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client` (`client_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `recorded_by` (`recorded_by`),
  CONSTRAINT `rf_client_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  CONSTRAINT `rf_recorded_by_fk` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 8. Grandfather existing clients -----------------------
-- Any client who existed before this migration is marked as paid.
-- New clients created AFTER this migration will have registration_fee_paid=1 by column default.
-- The approval flow will explicitly set registration_fee_paid=0 for new signups when fee is enabled.
UPDATE `clients` SET `registration_fee_paid` = 1 WHERE `registration_fee_paid` = 1; -- no-op safety: column default is already 1

-- ============================================================
-- ROLLBACK — do NOT run unless reverting. Commented out.
-- ============================================================
-- DROP TABLE IF EXISTS `registration_fees`;
-- ALTER TABLE `daraja_requests` DROP KEY `idx_reg_fee_client`, DROP COLUMN `registration_fee_client_id`;
-- ALTER TABLE `pending_registrations` DROP COLUMN `registration_fee_snapshot`;
-- ALTER TABLE `clients` DROP COLUMN `registration_fee_paid_at`, DROP COLUMN `registration_fee_amount`, DROP COLUMN `registration_fee_paid`;
-- DELETE FROM `app_settings` WHERE `setting_key` IN ('registration_fee','registration_fee_enabled');
