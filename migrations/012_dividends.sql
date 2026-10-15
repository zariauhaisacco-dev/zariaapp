-- ============================================================
-- Dividends module
-- ============================================================

-- Each year, admin declares a dividend (rate per share).
CREATE TABLE IF NOT EXISTS dividend_declarations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  financial_year VARCHAR(20) NOT NULL UNIQUE,    -- e.g. '2026' or '2025/2026'
  dividend_per_share DECIMAL(15,4) NOT NULL,     -- e.g. 15.0000 = KES 15 per share
  total_shares_at_declaration INT NOT NULL,
  total_payout DECIMAL(15,2) NOT NULL,
  status ENUM('draft','declared','distributed','cancelled') NOT NULL DEFAULT 'draft',
  notes VARCHAR(500) NULL,
  declared_by BIGINT UNSIGNED NULL,
  declared_at TIMESTAMP NULL,
  distributed_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_year (financial_year),
  FOREIGN KEY (declared_by) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per member per dividend declaration.
CREATE TABLE IF NOT EXISTS dividend_payouts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  declaration_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  shares_at_declaration INT NOT NULL,
  dividend_per_share DECIMAL(15,4) NOT NULL,
  gross_amount DECIMAL(15,2) NOT NULL,           -- shares × rate
  withholding_tax DECIMAL(15,2) NOT NULL DEFAULT 0,  -- 5% KRA withholding on dividends
  net_amount DECIMAL(15,2) NOT NULL,             -- gross - tax
  status ENUM('pending','credited','paid','failed') NOT NULL DEFAULT 'pending',
  credited_to_savings BOOLEAN NOT NULL DEFAULT FALSE,
  savings_transaction_id BIGINT UNSIGNED NULL,
  paid_at TIMESTAMP NULL,
  reference VARCHAR(100) NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_decl_client (declaration_id, client_id),
  INDEX idx_declaration (declaration_id),
  INDEX idx_client (client_id),
  INDEX idx_status (status),
  FOREIGN KEY (declaration_id) REFERENCES dividend_declarations(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
