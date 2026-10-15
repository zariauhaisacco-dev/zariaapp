-- ============================================================
-- Shares module
-- ============================================================

-- Global share configuration (single row)
CREATE TABLE IF NOT EXISTS shares_config (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  par_value DECIMAL(15,2) NOT NULL DEFAULT 100.00,
  min_shares_per_member INT NOT NULL DEFAULT 10,
  max_shares_per_member INT NOT NULL DEFAULT 10000,
  allow_transfers TINYINT(1) NOT NULL DEFAULT 1,
  allow_savings_purchase TINYINT(1) NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the single config row
INSERT IGNORE INTO shares_config (id, par_value, min_shares_per_member, max_shares_per_member)
VALUES (1, 100.00, 10, 10000);

-- Current holding per client
CREATE TABLE IF NOT EXISTS share_holdings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL UNIQUE,
  shares_held INT NOT NULL DEFAULT 0,
  total_purchased INT NOT NULL DEFAULT 0,
  total_redeemed INT NOT NULL DEFAULT 0,
  total_invested DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_redeemed_value DECIMAL(15,2) NOT NULL DEFAULT 0,
  first_purchase_at TIMESTAMP NULL,
  last_transaction_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shares (shares_held),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every share transaction (purchase, redemption, transfer_in, transfer_out)
CREATE TABLE IF NOT EXISTS share_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  holding_id BIGINT UNSIGNED NOT NULL,
  type ENUM('purchase','redemption','transfer_in','transfer_out','bonus') NOT NULL,
  shares INT NOT NULL,
  price_per_share DECIMAL(15,2) NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  shares_after INT NOT NULL,
  payment_source ENUM('cash','savings','system') NOT NULL DEFAULT 'cash',
  counterparty_client_id BIGINT UNSIGNED NULL,
  reference VARCHAR(100) NULL,
  notes VARCHAR(500) NULL,
  status ENUM('pending','completed','failed','reversed') NOT NULL DEFAULT 'completed',
  recorded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_holding (holding_id),
  INDEX idx_type (type),
  INDEX idx_created (created_at),
  FOREIGN KEY (holding_id) REFERENCES share_holdings(id) ON DELETE CASCADE,
  FOREIGN KEY (counterparty_client_id) REFERENCES clients(id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
