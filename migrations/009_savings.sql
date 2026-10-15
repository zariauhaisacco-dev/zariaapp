-- ============================================================
-- Savings module
-- ============================================================

-- One savings account per client
CREATE TABLE IF NOT EXISTS savings_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL UNIQUE,
  account_number VARCHAR(20) NOT NULL UNIQUE,   -- e.g. SAV-000123
  balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_deposited DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_withdrawn DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_interest_earned DECIMAL(15,2) NOT NULL DEFAULT 0,
  interest_rate DECIMAL(5,4) NOT NULL DEFAULT 0.05,   -- 5% per year (annual, credited monthly)
  status ENUM('active','dormant','closed') NOT NULL DEFAULT 'active',
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_transaction_at TIMESTAMP NULL,
  closed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_client (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every deposit/withdrawal/interest credit
CREATE TABLE IF NOT EXISTS savings_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  savings_account_id BIGINT UNSIGNED NOT NULL,
  type ENUM('deposit','withdrawal','interest','fee','adjustment') NOT NULL,
  amount DECIMAL(15,2) NOT NULL,                 -- always positive
  balance_after DECIMAL(15,2) NOT NULL,
  channel ENUM('cash','mpesa','bank','system') NOT NULL DEFAULT 'cash',
  mpesa_receipt VARCHAR(50) NULL,
  reference VARCHAR(100) NULL,
  notes VARCHAR(500) NULL,
  status ENUM('pending','completed','failed','reversed') NOT NULL DEFAULT 'completed',
  recorded_by BIGINT UNSIGNED NULL,              -- admin who recorded
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account (savings_account_id),
  INDEX idx_type (type),
  INDEX idx_created (created_at),
  FOREIGN KEY (savings_account_id) REFERENCES savings_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
