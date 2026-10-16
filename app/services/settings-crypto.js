/*
 * Zaria — Encryption helpers for admin-managed secrets.
 * AES-256-GCM. Storage: base64(iv || authTag || ciphertext).
 * Key from APP_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 * Fails closed if key missing. Never logs secrets.
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex) throw new Error('APP_ENCRYPTION_KEY not set');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('APP_ENCRYPTION_KEY must be 64 hex chars');
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  if (plaintext == null) return '';
  const s = String(plaintext);
  if (s.length === 0) return '';
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decrypt(encoded) {
  if (encoded == null) return '';
  const s = String(encoded);
  if (s.length === 0) return '';
  const key = getKey();
  const buf = Buffer.from(s, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('Encrypted value too short');
  const iv = buf.slice(0, IV_LEN);
  const tag = buf.slice(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.slice(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function isConfigured() {
  try { getKey(); return true; } catch (_) { return false; }
}

module.exports = { encrypt, decrypt, isConfigured };
