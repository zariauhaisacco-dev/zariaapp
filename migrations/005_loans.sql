CREATE TABLE IF NOT EXISTS loan_products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  min_amount DECIMAL(15,2) NOT NULL,
  max_amount DECIMAL(15,2) NOT NULL,
  interest_rate DECIMAL(5,4) NOT NULL,
  term_months INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  principal DECIMAL(15,2) NOT NULL,
  interest_rate DECIMAL(5,4) NOT NULL,
  term_months INT NOT NULL,
  total_repayable DECIMAL(15,2) NOT NULL,
  amount_repaid DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('pending','approved','active','repaid','overdue','defaulted','cancelled')
    NOT NULL DEFAULT 'pending',
  purpose VARCHAR(500) NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  disbursed_at TIMESTAMP NULL,
  closed_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (product_id) REFERENCES loan_products(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loan_payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  loan_id BIGINT UNSIGNED NOT NULL,
  installment_no INT NOT NULL,
  due_date DATE NOT NULL,
  amount_due DECIMAL(15,2) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  paid_at TIMESTAMP NULL,
  status ENUM('pending','paid','partial','overdue') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_loan (loan_id),
  INDEX idx_due (due_date),
  INDEX idx_status (status),
  UNIQUE KEY uniq_loan_installment (loan_id, installment_no),
  FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  loan_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  type ENUM('disbursement','repayment','late_fee','adjustment') NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  mpesa_receipt VARCHAR(50) NULL,
  originator_conversation_id VARCHAR(100) NULL,
  reference VARCHAR(100) NULL,
  status ENUM('pending','completed','failed','reversed') NOT NULL DEFAULT 'pending',
  notes VARCHAR(500) NULL,
  recorded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_loan (loan_id),
  INDEX idx_client (client_id),
  INDEX idx_type (type),
  INDEX idx_status (status),
  INDEX idx_receipt (mpesa_receipt),
  INDEX idx_created (created_at),
  FOREIGN KEY (loan_id) REFERENCES loans(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO loan_products (name, min_amount, max_amount, interest_rate, term_months)
SELECT * FROM (
  SELECT 'Starter' AS name, 1000.00 AS min_amount, 10000.00 AS max_amount, 0.1500 AS interest_rate, 1 AS term_months
  UNION ALL
  SELECT 'Standard', 10000.00, 50000.00, 0.1200, 3
  UNION ALL
  SELECT 'Premium', 50000.00, 200000.00, 0.1000, 6
) AS defaults
WHERE NOT EXISTS (SELECT 1 FROM loan_products LIMIT 1);
