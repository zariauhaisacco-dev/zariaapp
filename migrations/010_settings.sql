CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value VARCHAR(500) NOT NULL,
  description VARCHAR(500) NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed defaults
INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES
  ('loan_multiplier', '3', 'Max loan = savings_balance × this multiplier'),
  ('min_savings_ratio', '0.20', 'Minimum savings required = loan × this ratio (0.20 = 20%)'),
  ('require_savings_for_loan', '1', 'If 1, clients must have a savings account to apply for a loan');
