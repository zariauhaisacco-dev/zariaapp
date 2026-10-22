-- 025_broadcasts.sql
-- Admin broadcast messages sent to multiple clients at once.
-- Tracks subject, body, channels, audience, and delivery counts.

CREATE TABLE IF NOT EXISTS broadcasts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  channels ENUM('email','push','both') NOT NULL,
  audience_status ENUM('active','all','suspended') NOT NULL DEFAULT 'active',
  recipient_count INT NOT NULL DEFAULT 0,
  email_sent_count INT NOT NULL DEFAULT 0,
  email_failed_count INT NOT NULL DEFAULT 0,
  push_sent_count INT NOT NULL DEFAULT 0,
  push_failed_count INT NOT NULL DEFAULT 0,
  status ENUM('sending','completed','failed') NOT NULL DEFAULT 'sending',
  sent_by BIGINT UNSIGNED NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_status (status),
  KEY idx_sent_by (sent_by),
  KEY idx_started (started_at),
  CONSTRAINT fk_broadcast_admin FOREIGN KEY (sent_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
