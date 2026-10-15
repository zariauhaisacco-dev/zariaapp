-- 013_savings_interest_accruals.sql
-- Daily interest accrual ledger for savings accounts.
--
-- Design:
--   - One row per (savings_account_id, accrual_date) - enforced by UNIQUE key.
--     Idempotent: re-running accrueForDate() on the same day does nothing.
--   - posted = 0 means accrued but not yet credited to the account balance.
--   - posted = 1 means the row was summed into a monthly posting, credited
--     via savings.creditInterest(), and linked to a savings_transactions row.
--   - Interest is accrued daily (silent) and posted monthly (visible).
--
-- The table already exists in production, created manually during early
-- development. This migration is a no-op there (CREATE TABLE IF NOT EXISTS),
-- but ensures the schema is reproducible from migrations alone.

CREATE TABLE IF NOT EXISTS savings_interest_accruals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  savings_account_id BIGINT UNSIGNED NOT NULL,
  accrual_date DATE NOT NULL,
  closing_balance DECIMAL(15,2) NOT NULL,
  daily_interest DECIMAL(15,4) NOT NULL,
  rate_applied DECIMAL(5,4) NOT NULL,
  posted TINYINT(1) NOT NULL DEFAULT 0,
  posted_transaction_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_account_date (savings_account_id, accrual_date),
  KEY idx_posted (posted, accrual_date),
  CONSTRAINT fk_accr_account
    FOREIGN KEY (savings_account_id)
    REFERENCES savings_accounts (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
