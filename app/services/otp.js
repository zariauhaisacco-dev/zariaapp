/* Zaria — OTP service for admin 2FA
 * Generate, send, verify 6-digit codes via SMS or email.
 * Codes are SHA-256 hashed. Never store plaintext.
 */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const ping = require('./ping');
const email = require('./email');

const EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 3;
const RESEND_COOLDOWN_SEC = 30;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(3, local.length));
  return visible + '***@' + domain;
}

function maskPhone(phone) {
  if (!phone) return '';
  return phone.slice(0, 4) + '****' + phone.slice(-3);
}

async function createChallenge(userId, channel) {
  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  const [result] = await db.query(
    `INSERT INTO login_challenges (user_id, channel, code_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [userId, channel, codeHash, expiresAt]
  );

  return { challengeId: result.insertId, code };
}

async function sendCode(challengeId, userEmail, userPhone) {
  const [rows] = await db.query(
    'SELECT channel, code_hash FROM login_challenges WHERE id = ? AND status = ? LIMIT 1',
    [challengeId, 'pending']
  );
  if (!rows.length) throw new Error('Challenge not found or already used');

  // We need the plaintext code — but we only stored the hash.
  // Solution: return the code from createChallenge, pass it through.
  // In this simplified flow, caller passes code separately.
  throw new Error('Use sendChallenge(userId, channel) instead');
}

async function sendChallenge(userId, channel, userEmail, userPhone) {
  // Rate check: how many sends for this user in last 5 min?
  const [recent] = await db.query(
    `SELECT COUNT(*) AS cnt FROM login_challenges
     WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
    [userId]
  );
  if (recent[0].cnt >= MAX_SENDS) {
    return { ok: false, error: 'rate_limited', message: 'Too many attempts. Wait 15 minutes.' };
  }

  const { challengeId, code } = await createChallenge(userId, channel);

  if (channel === 'sms') {
    if (!userPhone) return { ok: false, error: 'no_phone', message: 'No phone on file' };
    const result = await ping.sendSms({
      to: userPhone,
      message: 'Your Zaria admin login code: ' + code + ' (valid ' + EXPIRY_MINUTES + ' min)',
    });
    if (!result.ok) return { ok: false, error: 'sms_failed', message: 'SMS could not be sent' };
    return {
      ok: true,
      challengeId,
      sentTo: 'sms',
      maskedTo: maskPhone(userPhone),
    };
  }

  if (channel === 'email') {
    if (!userEmail) return { ok: false, error: 'no_email', message: 'No email on file' };
    await email.send({
      to: userEmail,
      subject: 'Your Zaria login code',
      html: '<p>Your Zaria admin login code is:</p>' +
            '<p style="font-size:24px;font-weight:bold;letter-spacing:4px">' + code + '</p>' +
            '<p>Valid for ' + EXPIRY_MINUTES + ' minutes. If you did not request this, ignore this email.</p>',
    });
    return {
      ok: true,
      challengeId,
      sentTo: 'email',
      maskedTo: maskEmail(userEmail),
    };
  }

  return { ok: false, error: 'bad_channel', message: 'Unknown channel' };
}

async function verifyChallenge(challengeId, code) {
  const [rows] = await db.query(
    `SELECT id, user_id, code_hash, status, attempts, expires_at
       FROM login_challenges WHERE id = ? LIMIT 1`,
    [challengeId]
  );
  if (!rows.length) return { ok: false, error: 'not_found' };

  const c = rows[0];
  if (c.status !== 'pending') return { ok: false, error: 'already_used' };
  if (new Date(c.expires_at) < new Date()) {
    await db.query('UPDATE login_challenges SET status = ? WHERE id = ?', ['expired', challengeId]);
    return { ok: false, error: 'expired' };
  }
  if (c.attempts >= MAX_ATTEMPTS) {
    await db.query('UPDATE login_challenges SET status = ? WHERE id = ?', ['failed', challengeId]);
    return { ok: false, error: 'locked_out' };
  }

  // Increment attempts BEFORE comparing (so wrong codes count)
  await db.query('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?', [challengeId]);

  const provided = hashCode(code);
  if (provided !== c.code_hash) {
    return { ok: false, error: 'invalid', attemptsRemaining: MAX_ATTEMPTS - c.attempts - 1 };
  }

  // Success
  await db.query(
    'UPDATE login_challenges SET status = ?, verified_at = NOW() WHERE id = ?',
    ['verified', challengeId]
  );
  return { ok: true, userId: c.user_id };
}

async function cleanupExpired() {
  await db.query(
    `UPDATE login_challenges
        SET status = 'expired'
      WHERE status = 'pending' AND expires_at < NOW()`
  );
}

module.exports = {
  sendChallenge,
  verifyChallenge,
  cleanupExpired,
  maskPhone,
  maskEmail,
  EXPIRY_MINUTES,
};
