-- 022_daraja_b2c_fields.sql
-- Extend daraja_requests to support B2C (outgoing payments).
--
-- A single row represents either an STK Push (incoming) or B2C (outgoing),
-- determined by the direction column.
--
-- B2C-specific fields track identifiers returned by Safaricom's B2C API
-- and included in the callback so queued transactions can be reconciled.

ALTER TABLE daraja_requests
  ADD COLUMN b2c_transaction_id VARCHAR(50) NULL,
  ADD COLUMN b2c_conversation_id VARCHAR(80) NULL,
  ADD COLUMN b2c_originator_conversation_id VARCHAR(80) NULL,
  ADD COLUMN b2c_command_id VARCHAR(30) NULL,
  ADD COLUMN b2c_receiver_name VARCHAR(120) NULL,
  ADD KEY idx_b2c_transaction (b2c_transaction_id);
