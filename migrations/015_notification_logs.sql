-- 015_notification_logs.sql
-- Idempotent tracking tables for payment reminders and overdue escalations.
--
-- Rationale:
--   These two tables were originally created via CREATE TABLE IF NOT EXISTS
--   inside their respective cron jobs. That approach takes a brief table lock
--   on every run and hides the schema from source control. This migration
--   moves the definitions to migrations/ where they belong.
--
--   The CREATE TABLE IF NOT EXISTS clauses in the jobs will be removed in a
--   following commit. This migration is a no-op on the live database (both
--   tables already exist) but ensures the schema is reproducible.

CREATE TABLE IF NOT EXISTS reminder_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  loan_payment_id BIGINT UNSIGNED NOT NULL,
  stage_days INT NOT NULL,
  sent_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_payment_stage (loan_payment_id, stage_days),
  CONSTRAINT reminder_log_ibfk_1
    FOREIGN KEY (loan_payment_id) REFERENCES loan_payments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS escalation_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  loan_payment_id BIGINT UNSIGNED NOT NULL,
  stage_days INT NOT NULL,
  sent_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_payment_stage (loan_payment_id, stage_days),
  CONSTRAINT escalation_log_ibfk_1
    FOREIGN KEY (loan_payment_id) REFERENCES loan_payments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
