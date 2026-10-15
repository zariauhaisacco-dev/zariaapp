/*
 * Zaria — Email domain validation
 *
 * Validates that an email address's domain has an MX record — i.e., the domain
 * is set up to receive mail. This catches typos and fake domains that a
 * format-only check (Joi.email()) would let through.
 *
 * Does NOT verify the inbox itself exists. For that you need a verification
 * email flow (out of scope for now).
 *
 * Cached in memory: results are valid for CACHE_TTL_MS. Prevents repeated DNS
 * lookups for the same domain during a burst of signups.
 *
 * Set ALLOW_ANY_EMAIL_DOMAIN=1 in .env to bypass the check (for testing or
 * when running behind a restrictive resolver).
 */

const dns = require('dns').promises;

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // domain -> { ok, at }

function getDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase().trim();
}

/**
 * Returns true if the email's domain has at least one MX record.
 * Returns false on any error (DNS failure, malformed email, etc.).
 * Always returns true if ALLOW_ANY_EMAIL_DOMAIN=1.
 */
async function hasValidMx(email) {
  if (process.env.ALLOW_ANY_EMAIL_DOMAIN === '1') return true;

  const domain = getDomain(email);
  if (!domain) return false;

  const now = Date.now();
  const hit = cache.get(domain);
  if (hit && (now - hit.at) < CACHE_TTL_MS) {
    return hit.ok;
  }

  let ok = false;
  try {
    const records = await dns.resolveMx(domain);
    ok = Array.isArray(records) && records.length > 0;
  } catch (_) {
    ok = false;
  }

  cache.set(domain, { ok, at: now });
  return ok;
}

module.exports = { hasValidMx, getDomain };
