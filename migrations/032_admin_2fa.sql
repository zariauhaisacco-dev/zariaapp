-- Migration 032: Admin 2FA
-- Adds users.phone and login_challenges table
-- Emergency disable: UPDATE users SET phone = NULL WHERE id = 1;

ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL AFTER email;

CREATE TABLE IF NOT EXISTS login_challenges (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('sms','email') NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  status ENUM('pending','verified','expired','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP NULL,
  INDEX idx_user_status (user_id, status),
  INDEX idx_expires (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
