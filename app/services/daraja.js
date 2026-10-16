/*
 * Zaria — Daraja (M-Pesa) client
 *
 * Handles OAuth token caching, STK Push, and STK Push Query.
 * Sandbox and production share this code — switch via DARAJA_ENV.
 *
 * Key Daraja facts baked in:
 *   - Token expires in ~1 hour. Cached with 60s buffer.
 *   - STK password uses East Africa Time (UTC+3), NOT server time.
 *   - ResultCode 0 = success. Non-zero codes have distinct meanings.
 *   - Callbacks are unsigned. Never trust the body alone.
 */

const DARAJA_ENV = process.env.DARAJA_ENV || 'sandbox';
const BASE_URL = DARAJA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

const CONSUMER_KEY = process.env.DARAJA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.DARAJA_CONSUMER_SECRET;
const SHORTCODE = process.env.DARAJA_SHORTCODE;
const PASSKEY = process.env.DARAJA_PASSKEY;
const CALLBACK_URL = process.env.DARAJA_CALLBACK_URL || 'https://zariauhai.com/api/daraja/callback';

// Token cache
let cachedToken = null;
let tokenExpiresAt = 0;

function isConfigured() {
  return !!(CONSUMER_KEY && CONSUMER_SECRET && SHORTCODE && PASSKEY);
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const auth = Buffer.from(CONSUMER_KEY + ':' + CONSUMER_SECRET).toString('base64');
  const res = await fetch(BASE_URL + '/oauth/v1/generate?grant_type=client_credentials', {
    method: 'GET',
    headers: { Authorization: 'Basic ' + auth },
  });

  if (!res.ok) {
    throw new Error('Daraja auth failed: ' + res.status);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (parseInt(data.expires_in, 10) - 60) * 1000;
  return cachedToken;
}

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

function stkPassword() {
  const ts = eatTimestamp();
  return Buffer.from(SHORTCODE + PASSKEY + ts).toString('base64');
}

function invalidateToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

async function stkPush({ phone, amount, accountReference, description }) {
  let token = await getToken();
  const timestamp = eatTimestamp();

  const body = {
    BusinessShortCode: SHORTCODE,
    Password: Buffer.from(SHORTCODE + PASSKEY + timestamp).toString('base64'),
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(Number(amount)), // whole KES only
    PartyA: phone,
    PartyB: SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: CALLBACK_URL,
    AccountReference: (accountReference || 'Zaria').substring(0, 12),
    TransactionDesc: (description || 'Loan repayment').substring(0, 13),
  };

  let res = await fetch(BASE_URL + '/mpesa/stkpush/v1/processrequest', {
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
    res = await fetch(BASE_URL + '/mpesa/stkpush/v1/processrequest', {
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

async function stkQuery({ checkoutRequestId }) {
  const token = await getToken();
  const timestamp = eatTimestamp();

  const body = {
    BusinessShortCode: SHORTCODE,
    Password: Buffer.from(SHORTCODE + PASSKEY + timestamp).toString('base64'),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  const res = await fetch(BASE_URL + '/mpesa/stkpushquery/v1/query', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  // ResultCode: 0 = success, 1032 = cancelled, 1037 = unreachable, 1019 = timeout, 4999 = still processing
  return {
    resultCode: data.ResultCode != null ? parseInt(data.ResultCode, 10) : null,
    resultDesc: data.ResultDesc || null,
    raw: data,
  };
}

/*
 * Classify a ResultCode into a semantic state.
 * Returns: 'success' | 'failed' | 'cancelled' | 'timeout' | 'unreachable' | 'busy' | 'unknown'
 */
function classifyResultCode(code) {
  const n = Number(code);
  if (n === 0) return 'success';
  if (n === 1032) return 'cancelled';   // user cancelled
  if (n === 1037) return 'unreachable'; // phone unreachable
  if (n === 1019) return 'timeout';     // prompt expired
  if (n === 1001) return 'busy';        // another transaction in progress
  if (n === 4999) return 'pending';     // still processing
  return 'failed';
}

module.exports = {
  isConfigured,
  getToken,
  invalidateToken,
  stkPush,
  stkQuery,
  classifyResultCode,
  eatTimestamp,
};
