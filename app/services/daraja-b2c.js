/*
 * Zaria — Daraja B2C service
 *
 * Sends money from the SACCO's M-Pesa Paybill to a client's phone.
 * Used for loan disbursements, savings withdrawals (when enabled), and refunds.
 *
 * B2C differs from STK Push:
 *   - Direction: SACCO -> Client (vs Client -> SACCO)
 *   - Auth: OAuth token + SecurityCredential (pre-computed RSA blob)
 *   - Config: separate shortcode (Party A), initiator name, initiator password
 *
 * The SecurityCredential is stored pre-computed (encrypted at rest). This
 * avoids needing the Safaricom RSA certificate on the server, which they do
 * not publicly distribute.
 *
 * Config precedence: app_settings > env vars (same as STK).
 */

const db = require('../db');
const crypto = require('./settings-crypto');
const daraja = require('./daraja'); // reuse token + env base URL

const COMMAND_ID = 'BusinessPayment';
const IDENTIFIER_TYPE = '4'; // 4 = shortcode/organization
const DEFAULT_REMARKS = 'Loan disbursement';
const DEFAULT_OCCASION = 'Disbursement';

let cachedB2cConfig = null;

async function loadB2cConfig() {
  if (cachedB2cConfig) return cachedB2cConfig;

  let map = {};
  try {
    const [rows] = await db.query(
      "SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'daraja_b2c%'"
    );
    rows.forEach(function (r) { map[r.setting_key] = r.setting_value; });
  } catch (err) {
    console.error('[daraja-b2c] failed to read app_settings:', err.message);
  }

  let initiatorPass = '';
  if (map.daraja_b2c_initiator_pass_enc) {
    try { initiatorPass = crypto.decrypt(map.daraja_b2c_initiator_pass_enc); }
    catch (err) { console.error('[daraja-b2c] decrypt initiator_pass failed:', err.message); }
  }

  let securityCredential = '';
  if (map.daraja_b2c_security_credential_enc) {
    try { securityCredential = crypto.decrypt(map.daraja_b2c_security_credential_enc); }
    catch (err) { console.error('[daraja-b2c] decrypt security_credential failed:', err.message); }
  }

  // B2C consumer credentials (from a separate Daraja app).
  // Fall back to STK credentials if B2C-specific ones aren't set.
  let consumerKey = map.daraja_b2c_consumer_key || '';
  let consumerSecret = '';
  if (map.daraja_b2c_consumer_secret_enc) {
    try { consumerSecret = crypto.decrypt(map.daraja_b2c_consumer_secret_enc); }
    catch (err) { console.error('[daraja-b2c] decrypt consumer_secret failed:', err.message); }
  }

  cachedB2cConfig = {
    shortcode: map.daraja_b2c_shortcode || '',
    initiatorName: map.daraja_b2c_initiator_name || '',
    initiatorPass: initiatorPass,
    securityCredential: securityCredential,
    consumerKey: consumerKey,
    consumerSecret: consumerSecret,
  };

  return cachedB2cConfig;
}

function reloadB2cConfig() {
  cachedB2cConfig = null;
  cachedB2cToken = null;
  b2cTokenExpiresAt = 0;
}

// B2C-specific token cache
let cachedB2cToken = null;
let b2cTokenExpiresAt = 0;

async function getB2cToken() {
  if (cachedB2cToken && Date.now() < b2cTokenExpiresAt) {
    return cachedB2cToken;
  }

  const c = await loadB2cConfig();

  // If B2C-specific credentials are set, use them.
  // Otherwise fall back to the STK service's token.
  if (!c.consumerKey || !c.consumerSecret) {
    console.warn('[daraja-b2c] no B2C-specific credentials, falling back to STK token');
    return daraja.getToken();
  }

  const envConfig = await daraja.loadConfig();
  const auth = Buffer.from(c.consumerKey + ':' + c.consumerSecret).toString('base64');

  const res = await fetch(envConfig.baseUrl + '/oauth/v1/generate?grant_type=client_credentials', {
    method: 'GET',
    headers: { Authorization: 'Basic ' + auth },
  });

  if (!res.ok) {
    throw new Error('B2C auth failed: HTTP ' + res.status);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('B2C auth returned no token');
  }

  cachedB2cToken = data.access_token;
  b2cTokenExpiresAt = Date.now() + (parseInt(data.expires_in, 10) - 60) * 1000;
  return cachedB2cToken;
}

async function isConfigured() {
  const c = await loadB2cConfig();
  return !!(c.shortcode && c.initiatorName && c.securityCredential);
}

/**
 * Send a B2C payment request.
 *
 * @param {Object} opts
 * @param {String} opts.phone      — recipient in 2547XXXXXXXX format
 * @param {Number} opts.amount     — positive integer (whole KES)
 * @param {String} opts.remarks    — optional note
 * @param {String} opts.occasion   — optional occasion
 * @param {String} opts.resultUrl  — callback URL for final result
 * @param {String} opts.timeoutUrl — callback URL for queue timeout
 * @returns {Object}               — { conversationId, originatorConversationId, responseCode, responseDescription }
 */
async function sendB2C(opts) {
  const c = await loadB2cConfig();
  if (!c.shortcode || !c.initiatorName || !c.securityCredential) {
    throw new Error('B2C is not configured. Set initiator and SecurityCredential in admin settings.');
  }

  const token = await getB2cToken();
  const envConfig = await daraja.loadConfig();

  // OriginatorConversationID is required by the B2C v3 endpoint.
  // Format: <shortcode>_<segment>_<random-hex>
  const crypto = require('crypto');
  const originatorId = c.shortcode + '_ZARIA_' + crypto.randomBytes(8).toString('hex');

  const body = {
    OriginatorConversationID: originatorId,
    InitiatorName: c.initiatorName,
    SecurityCredential: c.securityCredential,
    CommandID: COMMAND_ID,
    Amount: Math.round(Number(opts.amount)),
    PartyA: c.shortcode,
    PartyB: opts.phone,
    Remarks: (opts.remarks || DEFAULT_REMARKS).substring(0, 100),
    QueueTimeOutURL: opts.timeoutUrl,
    ResultURL: opts.resultUrl,
    Occasion: (opts.occasion || DEFAULT_OCCASION).substring(0, 100),
  };

  const url = envConfig.baseUrl + '/mpesa/b2c/v3/paymentrequest';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.ResponseCode !== '0') {
    throw new Error('B2C rejected: ' + (data.errorMessage || data.ResponseDescription || 'unknown'));
  }

  return {
    conversationId: data.ConversationID,
    originatorConversationId: data.OriginatorConversationID,
    responseCode: data.ResponseCode,
    responseDescription: data.ResponseDescription,
  };
}

module.exports = {
  isConfigured,
  loadB2cConfig,
  reloadB2cConfig,
  getB2cToken,
  sendB2C,
  IDENTIFIER_TYPE,
  COMMAND_ID,
};
