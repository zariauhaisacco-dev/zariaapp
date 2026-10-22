-- ============================================================
-- Zaria — Migration 030: Broadcast SMS channel
-- 2026-10-21
--
-- Extends broadcasts.channels to include 'sms' and 'all'
-- Adds sms_sent_count / sms_failed_count columns
-- ============================================================

-- ---- 1. Extend channels enum --------------------------------
SET @has_all := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'broadcasts'
    AND COLUMN_NAME = 'channels'
    AND COLUMN_TYPE LIKE '%sms%'
);
SET @sql := IF(@has_all = 0,
  "ALTER TABLE `broadcasts` MODIFY COLUMN `channels` ENUM('email','push','sms','both','all') NOT NULL",
  'SELECT "broadcasts.channels already includes sms — skipped" AS msg'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- 2. Add sms_sent_count ----------------------------------
SET @has_sent := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'broadcasts' AND COLUMN_NAME = 'sms_sent_count'
);
SET @sql2 := IF(@has_sent = 0,
  'ALTER TABLE `broadcasts` ADD COLUMN `sms_sent_count` INT NOT NULL DEFAULT 0',
  'SELECT "broadcasts.sms_sent_count already exists" AS msg'
);
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

-- ---- 3. Add sms_failed_count --------------------------------
SET @has_failed := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'broadcasts' AND COLUMN_NAME = 'sms_failed_count'
);
SET @sql3 := IF(@has_failed = 0,
  'ALTER TABLE `broadcasts` ADD COLUMN `sms_failed_count` INT NOT NULL DEFAULT 0',
  'SELECT "broadcasts.sms_failed_count already exists" AS msg'
);
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ============================================================
-- ROLLBACK — commented out
-- ============================================================
-- ALTER TABLE `broadcasts` DROP COLUMN `sms_failed_count`, DROP COLUMN `sms_sent_count`;
-- ALTER TABLE `broadcasts` MODIFY COLUMN `channels` ENUM('email','push','both') NOT NULL;
