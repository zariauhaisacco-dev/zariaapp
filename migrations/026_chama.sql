-- ============================================================
-- Zaria — Migration 026: Chama (savings groups with contributions)
-- 2026-10-19
--
-- Adds:
--   - chamas                      (group master + min contribution)
--   - chama_savings_accounts      (one per chama, auto-opened on create)
--   - chama_savings_transactions  (chama ledger)
--   - chama_contributions         (per-member monthly obligation, min 300)
--   - chama_invites               (token-based invite)
--   - clients.chama_id            (nullable, one chama per client)
--   - daraja_requests.chama_savings_account_id (plain BIGINT, no FK — matches existing pattern)
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + information_schema guards on ALTERs.
-- Backward compatible: all existing rows have NULL for the new columns.
-- Rollback: see bottom of file (commented out).
-- ============================================================

-- ---- 1. chamas -------------------------------------------------
CREATE TABLE IF NOT EXISTS `chamas` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `description` VARCHAR(500) NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `monthly_contribution_min` DECIMAL(15,2) NOT NULL DEFAULT 300.00,
  `times_money_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `times_money_order` ENUM('rotation','fixed','random') NOT NULL DEFAULT 'rotation',
  `times_money_next_client_id` BIGINT UNSIGNED NULL,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_code` (`code`),
  KEY `idx_status` (`status`),
  KEY `created_by` (`created_by`),
  KEY `times_money_next_client_id` (`times_money_next_client_id`),
  CONSTRAINT `chamas_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`),
  CONSTRAINT `chamas_next_client_fk` FOREIGN KEY (`times_money_next_client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 2. chama_savings_accounts ---------------------------------
CREATE TABLE IF NOT EXISTS `chama_savings_accounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chama_id` BIGINT UNSIGNED NOT NULL,
  `account_number` VARCHAR(20) NOT NULL,
  `balance` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `total_contributed` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `total_withdrawn` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('active','dormant','closed') NOT NULL DEFAULT 'active',
  `opened_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `last_transaction_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_chama` (`chama_id`),
  UNIQUE KEY `uniq_account_number` (`account_number`),
  KEY `idx_status` (`status`),
  CONSTRAINT `csa_chama_fk` FOREIGN KEY (`chama_id`) REFERENCES `chamas`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 3. chama_savings_transactions -----------------------------
CREATE TABLE IF NOT EXISTS `chama_savings_transactions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chama_savings_account_id` BIGINT UNSIGNED NOT NULL,
  `client_id` BIGINT UNSIGNED NULL,
  `type` ENUM('contribution','withdrawal','payout','adjustment') NOT NULL,
  `amount` DECIMAL(15,2) NOT NULL,
  `balance_after` DECIMAL(15,2) NOT NULL,
  `channel` ENUM('cash','mpesa','bank','system') NOT NULL,
  `mpesa_receipt` VARCHAR(50) NULL,
  `reference` VARCHAR(100) NULL,
  `notes` VARCHAR(500) NULL,
  `status` ENUM('pending','completed','failed','reversed') NOT NULL DEFAULT 'completed',
  `recorded_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_account` (`chama_savings_account_id`),
  KEY `idx_client` (`client_id`),
  KEY `idx_type` (`type`),
  KEY `idx_created` (`created_at`),
  KEY `recorded_by` (`recorded_by`),
  CONSTRAINT `cst_account_fk` FOREIGN KEY (`chama_savings_account_id`) REFERENCES `chama_savings_accounts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `cst_client_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `cst_recorded_by_fk` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 4. chama_contributions ------------------------------------
CREATE TABLE IF NOT EXISTS `chama_contributions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chama_id` BIGINT UNSIGNED NOT NULL,
  `client_id` BIGINT UNSIGNED NOT NULL,
  `period` VARCHAR(20) NOT NULL,
  `amount_due` DECIMAL(15,2) NOT NULL,
  `amount_paid` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('pending','partial','paid','overdue','waived') NOT NULL DEFAULT 'pending',
  `last_payment_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_chama_client_period` (`chama_id`,`client_id`,`period`),
  KEY `idx_status` (`status`),
  KEY `idx_period` (`period`),
  KEY `client_id` (`client_id`),
  CONSTRAINT `cc_chama_fk` FOREIGN KEY (`chama_id`) REFERENCES `chamas`(`id`) ON DELETE CASCADE,
  CONSTRAINT `cc_client_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 5. chama_invites ------------------------------------------
CREATE TABLE IF NOT EXISTS `chama_invites` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chama_id` BIGINT UNSIGNED NOT NULL,
  `client_id` BIGINT UNSIGNED NULL,
  `email` VARCHAR(255) NULL,
  `token` VARCHAR(64) NOT NULL,
  `status` ENUM('pending','accepted','declined','expired') NOT NULL DEFAULT 'pending',
  `expires_at` TIMESTAMP NOT NULL,
  `invited_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `responded_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_token` (`token`),
  KEY `idx_status` (`status`),
  KEY `idx_chama` (`chama_id`),
  KEY `client_id` (`client_id`),
  KEY `invited_by` (`invited_by`),
  CONSTRAINT `ci_chama_fk` FOREIGN KEY (`chama_id`) REFERENCES `chamas`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ci_client_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `ci_invited_by_fk` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 6. clients.chama_id (guarded) -----------------------------
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'chama_id'
);
SET @sql := IF(@has_col = 0,
  'ALTER TABLE `clients`
     ADD COLUMN `chama_id` BIGINT UNSIGNED NULL,
     ADD KEY `idx_chama` (`chama_id`),
     ADD CONSTRAINT `clients_chama_fk` FOREIGN KEY (`chama_id`) REFERENCES `chamas`(`id`) ON DELETE SET NULL',
  'SELECT "clients.chama_id already exists — skipped" AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 7. daraja_requests.chama_savings_account_id (guarded) -----
-- No FK constraint — matches existing pattern (savings_account_id has no FK).
SET @has_col2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daraja_requests' AND COLUMN_NAME = 'chama_savings_account_id'
);
SET @sql2 := IF(@has_col2 = 0,
  'ALTER TABLE `daraja_requests`
     ADD COLUMN `chama_savings_account_id` BIGINT UNSIGNED NULL,
     ADD KEY `idx_chama_acct` (`chama_savings_account_id`)',
  'SELECT "daraja_requests.chama_savings_account_id already exists — skipped" AS msg'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- ============================================================
-- ROLLBACK — do NOT run unless reverting the feature.
-- Commented out intentionally.
-- ============================================================
-- ALTER TABLE `daraja_requests` DROP KEY `idx_chama_acct`,
--                              DROP COLUMN `chama_savings_account_id`;
-- ALTER TABLE `clients` DROP FOREIGN KEY `clients_chama_fk`,
--                       DROP KEY `idx_chama`,
--                       DROP COLUMN `chama_id`;
-- DROP TABLE IF EXISTS `chama_invites`;
-- DROP TABLE IF EXISTS `chama_contributions`;
-- DROP TABLE IF EXISTS `chama_savings_transactions`;
-- DROP TABLE IF EXISTS `chama_savings_accounts`;
-- DROP TABLE IF EXISTS `chamas`;
