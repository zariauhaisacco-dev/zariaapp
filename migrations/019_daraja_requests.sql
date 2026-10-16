-- 019_daraja_requests.sql
-- Tracks STK Push and B2C requests for reconciliation.

CREATE TABLE IF NOT EXISTS daraja_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id BIGINT UNSIGNED NULL,
  loan_id BIGINT UNSIGNED NULL,
  checkout_request_id VARCHAR(100) NULL,
  merchant_request_id VARCHAR(100) NULL,
  mpesa_receipt VARCHAR(50) NULL,
  phone VARCHAR(20) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  direction ENUM('stk_push','b2c') NOT NULL DEFAULT 'stk_push',
  status ENUM('pending','success','failed','timeout','cancelled') NOT NULL DEFAULT 'pending',
  result_code INT NULL,
  result_desc VARCHAR(500) NULL,
  raw_callback JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_checkout_request (checkout_request_id),
  KEY idx_client (client_id),
  KEY idx_loan (loan_id),
  KEY idx_status (status),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
