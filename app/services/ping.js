/*
 * Zaria — Ping Africa communication service
 * SMS + WhatsApp + USSD via bulk.ping.africa
 */

const db = require('../db');

const BASE_URL = 'https://bulk.ping.africa/api';

// ---------------------------------------------------------------
// Phone normalization
// ---------------------------------------------------------------
function normalizePhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1);
  if (digits.length === 9 && /^[17]/.test(digits)) return '254' + digits;
  return null;
}

// ---------------------------------------------------------------
// Config loader (app_settings with .env fallback)
// ---------------------------------------------------------------
let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000;

async function loadConfig() {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) return cachedConfig;

  let enabled = false;
  let senderId = process.env.PING_AFRICA_SENDER_ID || 'PING-AFRICA';
  let whatsappInstance = process.env.PING_AFRICA_WHATSAPP_INSTANCE || '';
  let ussdCode = process.env.PING_AFRICA_USSD_CODE || '';
  let token = process.env.PING_AFRICA_TOKEN || '';
  let dailyLimit = 10;

  try {
    const [rows] = await db.query(
      "SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'ping_%'"
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    enabled = map.ping_enabled === '1';
    if (map.ping_sender_id) senderId = map.ping_sender_id;
    if (map.ping_whatsapp_instance) whatsappInstance = map.ping_whatsapp_instance;
    if (map.ping_ussd_code) ussdCode = map.ping_ussd_code;
    if (map.ping_daily_sms_limit) dailyLimit = Number(map.ping_daily_sms_limit);
  } catch (err) {
    console.error('[ping] config read failed:', err.message);
  }

  cachedConfig = { enabled, senderId, whatsappInstance, ussdCode, token, dailyLimit };
  cacheTime = Date.now();
  return cachedConfig;
}

function reloadConfig() {
  cachedConfig = null;
  cacheTime = 0;
}

// ---------------------------------------------------------------
// HTTP call
// ---------------------------------------------------------------
async function apiCall(method, path, body) {
  const cfg = await loadConfig();
  if (!cfg.token) throw new Error('Ping Africa token not configured');

  const opts = {
    method,
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(BASE_URL + path, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.error || data.message || ('HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------
// Credits
// ---------------------------------------------------------------
async function getCredits() {
  return apiCall('GET', '/credits/balance');
}

async function estimateCost({ serviceType = 'sms_local', quantity = 1 }) {
  return apiCall('POST', '/credits/estimate', {
    service_type: serviceType,
    quantity,
  });
}

// ---------------------------------------------------------------
// Daily limit tracking
// ---------------------------------------------------------------
async function countTodaySms(clientId) {
  if (!clientId) return 0;
  const [rows] = await db.query(
    "SELECT COUNT(*) AS c FROM sms_logs WHERE client_id = ? AND created_at >= CURDATE()",
    [clientId]
  );
  return rows[0] ? rows[0].c : 0;
}

// ---------------------------------------------------------------
// Send SMS
// ---------------------------------------------------------------
async function sendSms({ to, message, template, clientId, throwOnFail }) {
  const cfg = await loadConfig();
  if (!cfg.enabled) {
    return { ok: false, skipped: true, reason: 'Ping disabled' };
  }

  const phone = normalizePhone(to);
  if (!phone) {
    await logSms({ clientId, phone: to, message, template, status: 'failed', errorMessage: 'Invalid phone' });
    return { ok: false, error: 'Invalid phone' };
  }

  // Daily limit check
  if (clientId) {
    const todayCount = await countTodaySms(clientId);
    if (todayCount >= cfg.dailyLimit) {
      await logSms({ clientId, phone, message, template, status: 'failed', errorMessage: 'Daily limit exceeded' });
      return { ok: false, error: 'Daily limit exceeded' };
    }
  }

  // Truncate to 160 chars (single segment)
  const msg = String(message).substring(0, 160);

  try {
    const result = await apiCall('POST', '/sms/send', {
      recipient: phone,
      message: msg,
      sender_id: cfg.senderId,
    });

    const msgId = result.message && result.message.id;
    const parts = result.message && result.message.parts;
    const credits = Number(result.credits_charged || 0);

    await logSms({
      clientId, phone, message: msg, template,
      status: 'sent',
      providerMessageId: msgId,
      transactionReference: result.transaction_reference,
      creditsCharged: credits,
      parts,
    });

    return { ok: true, providerId: msgId, credits };
  } catch (err) {
    await logSms({
      clientId, phone, message: msg, template,
      status: 'failed',
      errorMessage: String(err.message || err),
    });
    if (throwOnFail) throw err;
    return { ok: false, error: err.message };
  }
}

async function logSms({ clientId, phone, message, template, status, providerMessageId, transactionReference, creditsCharged, parts, errorMessage }) {
  try {
    await db.query(
      `INSERT INTO sms_logs
        (client_id, phone, message, template, status, provider_message_id,
         transaction_reference, credits_charged, parts, error_message, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId || null, phone || 'unknown', message || '', template || null, status,
        providerMessageId || null, transactionReference || null,
        creditsCharged || null, parts || 1, errorMessage || null,
        status === 'sent' ? new Date() : null,
      ]
    );
  } catch (err) {
    console.error('[ping logSms]', err.message);
  }
}

// ---------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------
async function sendWhatsAppText({ to, text, template, clientId, throwOnFail }) {
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.whatsappInstance) {
    return { ok: false, skipped: true, reason: 'WhatsApp instance not configured' };
  }

  const phone = normalizePhone(to);
  if (!phone) {
    await logWhatsApp({ clientId, phone: to, type: 'text', textContent: text, template, status: 'failed', errorMessage: 'Invalid phone' });
    return { ok: false, error: 'Invalid phone' };
  }

  try {
    const result = await apiCall('POST', '/whatsapp/messages/text', {
      instanceName: cfg.whatsappInstance,
      number: phone,
      text: String(text),
    });

    const msgId = result.data && result.data.key && result.data.key.id;

    await logWhatsApp({
      clientId, phone, type: 'text', textContent: text, template,
      status: 'sent', providerMessageId: msgId,
    });
    return { ok: true, providerId: msgId };
  } catch (err) {
    await logWhatsApp({
      clientId, phone, type: 'text', textContent: text, template,
      status: 'failed', errorMessage: String(err.message || err),
    });
    if (throwOnFail) throw err;
    return { ok: false, error: err.message };
  }
}

async function sendWhatsAppMedia({ to, mediaUrl, mediatype, caption, fileName, template, clientId, throwOnFail }) {
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.whatsappInstance) {
    return { ok: false, skipped: true, reason: 'WhatsApp instance not configured' };
  }

  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: 'Invalid phone' };

  try {
    const result = await apiCall('POST', '/whatsapp/messages/media', {
      instanceName: cfg.whatsappInstance,
      number: phone,
      mediatype: mediatype || 'document',
      media: mediaUrl,
      caption: caption || '',
      fileName: fileName || '',
    });

    const msgId = result.data && result.data.key && result.data.key.id;

    await logWhatsApp({
      clientId, phone, type: mediatype || 'document',
      mediaUrl, mediaCaption: caption, mediaFilename: fileName, template,
      status: 'sent', providerMessageId: msgId,
    });
    return { ok: true, providerId: msgId };
  } catch (err) {
    await logWhatsApp({
      clientId, phone, type: mediatype || 'document',
      mediaUrl, mediaCaption: caption, mediaFilename: fileName, template,
      status: 'failed', errorMessage: String(err.message || err),
    });
    if (throwOnFail) throw err;
    return { ok: false, error: err.message };
  }
}

async function logWhatsApp({ clientId, phone, type, textContent, mediaUrl, mediaCaption, mediaFilename, template, status, providerMessageId, errorMessage }) {
  try {
    await db.query(
      `INSERT INTO whatsapp_logs
        (client_id, phone, message_type, text_content, media_url, media_caption, media_filename,
         template, status, provider_message_id, error_message, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId || null, phone || 'unknown', type || 'text',
        textContent || null, mediaUrl || null, mediaCaption || null, mediaFilename || null,
        template || null, status, providerMessageId || null, errorMessage || null,
        status === 'sent' ? new Date() : null,
      ]
    );
  } catch (err) {
    console.error('[ping logWhatsApp]', err.message);
  }
}

// ---------------------------------------------------------------
// USSD
// ---------------------------------------------------------------
async function ussdInitiate({ sessionId, phoneNumber, serviceCode }) {
  return apiCall('POST', '/ussd/initiate', {
    session_id: sessionId,
    phone_number: phoneNumber,
    service_code: serviceCode,
  });
}

async function ussdInteract({ sessionId, userInput }) {
  return apiCall('POST', '/ussd/interact/' + encodeURIComponent(sessionId), {
    user_input: String(userInput),
  });
}

async function ussdComplete({ sessionId }) {
  return apiCall('POST', '/ussd/complete/' + encodeURIComponent(sessionId));
}

async function ussdCancel({ sessionId }) {
  return apiCall('POST', '/ussd/cancel/' + encodeURIComponent(sessionId));
}

module.exports = {
  normalizePhone,
  loadConfig,
  reloadConfig,
  getCredits,
  estimateCost,
  sendSms,
  sendWhatsAppText,
  sendWhatsAppMedia,
  ussdInitiate,
  ussdInteract,
  ussdComplete,
  ussdCancel,
};
