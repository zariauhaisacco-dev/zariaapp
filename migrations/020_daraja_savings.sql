-- 020_daraja_savings.sql
-- Allow daraja_requests to target a savings account instead of a loan.
-- A single STK Push row will have EITHER loan_id OR savings_account_id set
-- (or neither if it's a test/no-op), but never both.

ALTER TABLE daraja_requests
  MODIFY COLUMN loan_id BIGINT UNSIGNED NULL,
  ADD COLUMN savings_account_id BIGINT UNSIGNED NULL AFTER loan_id,
  ADD KEY idx_savings_account (savings_account_id);
