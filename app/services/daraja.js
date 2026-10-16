/*
 * Zaria — Daraja (M-Pesa) client
 *
 * Reads configuration from app_settings (admin-editable via UI) with a
 * fallback to environment variables for bootstrap and local development.
 *
 * Sandbox and production share the code — switch by changing daraja_env
 * in app_settings. No code changes required to go live.
 *
 * Key Daraja facts baked in:
 *   - Token expires in ~1 hour. Cached with 60s buffer.
 *   - STK password uses East Africa Time (UTC+3), NOT server time.
 *   - ResultCode 0 = success. Non-zero codes have distinct meanings.
 *   - Callbacks are unsigned. Never trust the body alone for high-value txns.
 *
 * Admin updates credentials via POST /api/admin/settings/daraja. That handler
 * calls reloadConfig() so the next API call uses the new values immediately —
 * no app restart.
 */

const db = require('../db');
const crypto = require('./settings-crypto');

let cachedConfig = null;
let cachedToken = null;
let tokenExpiresAt = 0;

const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

// ---------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------

async function loadConfig() {
  if (cachedConfig) return cachedConfig;

  let map = {};
  try {
    const [rows] = await db.query(
      "SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'daraja_%'"
    );
    rows.forEach(function (r) { map[r.setting_key] = r.setting_value; });
  } catch (err) {
    console.error('[daraja] failed to read app_settings:', err.message);
    // Fall through to env
  }

  // Decrypt secrets only if they exist; otherwise fall back to env
  let consumerSecret = process.env.DARAJA_CONSUMER_SECRET || '';
  if (map.daraja_consumer_secret_enc) {
    try {
      consumerSecret = crypto.decrypt(map.daraja_consumer_secret_enc);
    } catch (err) {
      console.error('[daraja] decrypt consumer_secret failed:', err.message);
    }
  }

  let passkey = process.env.DARAJA_PASSKEY || '';
  if (map.daraja_passkey_enc) {
    try {
      passkey = crypto.decrypt(map.daraja_passkey_enc);
    } catch (err) {
      console.error('[daraja] decrypt passkey failed:', err.message);
    }
  }

  let b2cInitiatorPass = '';
  if (map.daraja_b2c_initiator_pass_enc) {
    try {
      b2cInitiatorPass = crypto.decrypt(map.daraja_b2c_initiator_pass_enc);
    } catch (err) {
      console.error('[daraja] decrypt b2c initiator pass failed:', err.message);
    }
  }

  const env = map.daraja_env || process.env.DARAJA_ENV || 'sandbox';

  cachedConfig = {
    env: env,
    baseUrl: BASE_URLS[env] || BASE_URLS.sandbox,
    shortcode: map.daraja_shortcode || process.env.DARAJA_SHORTCODE || '',
    consumerKey: map.daraja_consumer_key || process.env.DARAJA_CONSUMER_KEY || '',
    consumerSecret: consumerSecret,
    passkey: passkey,
    callbackUrl: map.daraja_callback_url
      || process.env.DARAJA_CALLBACK_URL
      || 'https://zariauhai.com/api/daraja/callback',
    b2cShortcode: map.daraja_b2c_shortcode || '',
    b2cInitiatorName: map.daraja_b2c_initiator_name || '',
    b2cInitiatorPass: b2cInitiatorPass,
  };

  return cachedConfig;
}

/**
 * Force the next call to reload config from DB. Also clears the token cache
 * because the new credentials may require a fresh token.
 */
function reloadConfig() {
  cachedConfig = null;
  cachedToken = null;
  tokenExpiresAt = 0;
}

async function isConfigured() {
  const c = await loadConfig();
  return !!(c.consumerKey && c.consumerSecret && c.shortcode && c.passkey);
}

// ---------------------------------------------------------------
// OAuth token (cached)
// ---------------------------------------------------------------

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const c = await loadConfig();
  const auth = Buffer.from(c.consumerKey + ':' + c.consumerSecret).toString('base64');

  const res = await fetch(c.baseUrl + '/oauth/v1/generate?grant_type=client_credentials', {
    method: 'GET',
    headers: { Authorization: 'Basic ' + auth },
  });

  if (!res.ok) {
    throw new Error('Daraja auth failed: HTTP ' + res.status);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Daraja auth returned no token');
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (parseInt(data.expires_in, 10) - 60) * 1000;
  return cachedToken;
}

function invalidateToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

// EAT timestamp: YYYYMMDDHHmmss in UTC+3
function eatTimestamp() {
  const now = new Date();
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return eat.getUTCFullYear() +
    pad(eat.getUTCMonth() + 1) +
    pad(eat.getUTCDate()) +
    pad(eat.getUTCHours()) +
    pad(eat.getUTCMinutes()) +
    pad(eat.getUTCSeconds());
}

function buildStkPassword(shortcode, passkey, timestamp) {
  return Buffer.from(shortcode + passkey + timestamp).toString('base64');
}

// ---------------------------------------------------------------
// STK Push
// ---------------------------------------------------------------

async function stkPush({ phone, amount, accountReference, description }) {
  const c = await loadConfig();
  let token = await getToken();

  const timestamp = eatTimestamp();
  const password = buildStkPassword(c.shortcode, c.passkey, timestamp);

  const body = {
    BusinessShortCode: c.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(Number(amount)),
    PartyA: phone,
    PartyB: c.shortcode,
    PhoneNumber: phone,
    CallBackURL: c.callbackUrl,
    AccountReference: (accountReference || 'Zaria').substring(0, 12),
    TransactionDesc: (description || 'Loan repayment').substring(0, 13),
  };

  let res = await fetch(c.baseUrl + '/mpesa/stkpush/v1/processrequest', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let data = await res.json();

  // If token was stale, refresh once and retry
  if (data.errorCode === '404.001.03' || (data.errorMessage || '').includes('Invalid Access Token')) {
    console.warn('[daraja] stale token — refreshing and retrying once');
    invalidateToken();
    token = await getToken();
    res = await fetch(c.baseUrl + '/mpesa/stkpush/v1/processrequest', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    data = await res.json();
  }

  if (data.ResponseCode !== '0') {
    throw new Error('STK Push rejected: ' + (data.errorMessage || data.ResponseDescription || 'unknown'));
  }

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    responseCode: data.ResponseCode,
    responseDescription: data.ResponseDescription,
  };
}

// ---------------------------------------------------------------
// STK Push Query
// ---------------------------------------------------------------

async function stkQuery({ checkoutRequestId }) {
  const c = await loadConfig();
  const token = await getToken();
  const timestamp = eatTimestamp();
  const password = buildStkPassword(c.shortcode, c.passkey, timestamp);

  const body = {
    BusinessShortCode: c.shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  const res = await fetch(c.baseUrl + '/mpesa/stkpushquery/v1/query', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  return {
    resultCode: data.ResultCode != null ? parseInt(data.ResultCode, 10) : null,
    resultDesc: data.ResultDesc || null,
    raw: data,
  };
}

// ---------------------------------------------------------------
// Result classification
// ---------------------------------------------------------------

function classifyResultCode(code) {
  const n = Number(code);
  if (n === 0) return 'success';
  if (n === 1032) return 'cancelled';
  if (n === 1037) return 'unreachable';
  if (n === 1019) return 'timeout';
  if (n === 1001) return 'busy';
  if (n === 4999) return 'pending';
  return 'failed';
}

// ---------------------------------------------------------------
// Exports
// ---------------------------------------------------------------

module.exports = {
  isConfigured,
  loadConfig,
  reloadConfig,
  getToken,
  invalidateToken,
  stkPush,
  stkQuery,
  classifyResultCode,
  eatTimestamp,
};
