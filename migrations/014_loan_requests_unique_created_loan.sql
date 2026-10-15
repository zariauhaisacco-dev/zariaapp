-- 014_loan_requests_unique_created_loan.sql
-- Ensure a loan_request can be linked to at most one loan.
--
-- Rationale:
--   The approve flow creates a loan and links it via
--   loan_requests.created_loan_id. Without a UNIQUE constraint, a code bug
--   could link the same loan to two requests, or link a request to a loan
--   created for a different request.
--
-- MySQL treats NULL as distinct in UNIQUE indexes, so multiple requests
-- with created_loan_id = NULL (pending, rejected, cancelled) are still
-- allowed. Only non-NULL links are constrained.
--
-- This adds a NEW unique index alongside the existing FK-supporting index
-- (created_loan_id). The FK index requirement is satisfied by either.

ALTER TABLE loan_requests
  ADD UNIQUE KEY uniq_created_loan_id (created_loan_id);
