-- ============================================================
-- Zaria — Migration 027: pending_registrations chama link
-- 2026-10-19
--
-- Purpose: allow signup via chama invite.
--   - chama_id: which chama the applicant should be auto-enrolled into on approval
--   - chama_invite_id: which invite created this signup (marked accepted on approval)
--
-- Both columns nullable. Existing rows (no invite) stay NULL.
--
-- Idempotent: guards each ALTER against already-existing columns.
-- Rollback: see bottom of file.
-- ============================================================

-- ---- 1. Add chama_id (guarded) --------------------------------
SET @has_chama := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pending_registrations'
    AND COLUMN_NAME = 'chama_id'
);
SET @sql := IF(@has_chama = 0,
  'ALTER TABLE `pending_registrations`
     ADD COLUMN `chama_id` BIGINT UNSIGNED NULL AFTER `heard_about`,
     ADD KEY `idx_chama` (`chama_id`),
     ADD CONSTRAINT `pr_chama_fk` FOREIGN KEY (`chama_id`) REFERENCES `chamas`(`id`) ON DELETE SET NULL',
  'SELECT "pending_registrations.chama_id already exists — skipped" AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 2. Add chama_invite_id (guarded) ------------------------
SET @has_invite := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pending_registrations'
    AND COLUMN_NAME = 'chama_invite_id'
);
SET @sql2 := IF(@has_invite = 0,
  'ALTER TABLE `pending_registrations`
     ADD COLUMN `chama_invite_id` BIGINT UNSIGNED NULL AFTER `chama_id`,
     ADD KEY `idx_chama_invite` (`chama_invite_id`),
     ADD CONSTRAINT `pr_chama_invite_fk` FOREIGN KEY (`chama_invite_id`) REFERENCES `chama_invites`(`id`) ON DELETE SET NULL',
  'SELECT "pending_registrations.chama_invite_id already exists — skipped" AS msg'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- ============================================================
-- ROLLBACK — do NOT run unless reverting. Commented out.
-- ============================================================
-- ALTER TABLE `pending_registrations`
--   DROP FOREIGN KEY `pr_chama_invite_fk`,
--   DROP KEY `idx_chama_invite`,
--   DROP COLUMN `chama_invite_id`,
--   DROP FOREIGN KEY `pr_chama_fk`,
--   DROP KEY `idx_chama`,
--   DROP COLUMN `chama_id`;
