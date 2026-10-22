/*
 * Zaria — Broadcast service
 *
 * Sends a message to multiple clients via email and/or push.
 * Batched (50 at a time) to avoid SMTP throttling on shared hosting.
 *
 * Design:
 *   - previewBroadcast()   : counts recipients without sending
 *   - sendBroadcast()      : creates row, sends in background, returns immediately
 *   - getBroadcast()       : fetch status/result
 *   - listBroadcasts()     : paginated history
 *
 * The actual sending runs async (fire-and-forget from the HTTP handler) so
 * the admin sees "sending" immediately and refreshes to see final counts.
 */

const db = require('../db');
const email = require('./email');
const push = require('./push');
const ping = require('./ping');
const audit = require('./audit');

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 100;

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/**
 * Count how many clients match the audience filter.
 */
async function previewBroadcast({ audienceStatus }) {
  const status = audienceStatus || 'active';
  let where = '';
  const params = [];

  if (status === 'active')    where = "WHERE status = 'active'";
  else if (status === 'suspended') where = "WHERE status = 'suspended'";
  // 'all' = no filter

  const [rows] = await db.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN u.email IS NOT NULL AND u.email <> '' THEN 1 ELSE 0 END) AS with_email,
       (SELECT COUNT(DISTINCT c2.id) FROM clients c2
          JOIN push_subscriptions ps ON ps.client_id = c2.id
          ${status === 'active' ? "WHERE c2.status = 'active'" : status === 'suspended' ? "WHERE c2.status = 'suspended'" : ''}
       ) AS with_push,
       SUM(CASE WHEN c.phone IS NOT NULL AND c.phone <> '' AND (c.sms_opt_out IS NULL OR c.sms_opt_out = 0) THEN 1 ELSE 0 END) AS with_sms
     FROM clients c
     JOIN users u ON u.id = c.user_id
     ${where}`,
    params
  );

  const r = rows[0] || {};
  return {
    total: Number(r.total || 0),
    with_email: Number(r.with_email || 0),
    with_push: Number(r.with_push || 0),
    with_sms: Number(r.with_sms || 0),
  };
}

/**
 * Creates a broadcast row and starts sending in the background.
 * Returns immediately with the broadcast id.
 */
async function startBroadcast({ subject, body, channels, audienceStatus, adminId, adminIp, adminUserAgent }) {
  const status = audienceStatus || 'active';
  const preview = await previewBroadcast({ audienceStatus: status });

  if (preview.total === 0) {
    throw new Error('No recipients match the audience filter');
  }

  const [ins] = await db.query(
    `INSERT INTO broadcasts
      (subject, body, channels, audience_status, recipient_count, sent_by, status)
     VALUES (?, ?, ?, ?, ?, ?, 'sending')`,
    [subject, body, channels, status, preview.total, adminId]
  );
  const broadcastId = ins.insertId;

  await audit.log({
    actorUserId: adminId,
    actorRole: 'admin',
    action: 'broadcast.started',
    entityType: 'broadcast',
    entityId: broadcastId,
    newValues: {
      subject,
      channels,
      audience_status: status,
      recipient_count: preview.total,
    },
    ip: adminIp,
    userAgent: adminUserAgent,
  });

  // Fire and forget — sending happens in background
  setImmediate(function () {
    runBroadcast(broadcastId).catch(function (err) {
      console.error('[broadcast] background failure:', err.message);
    });
  });

  return { id: broadcastId, preview };
}

/**
 * The actual sending loop. Runs after startBroadcast returns.
 */
async function runBroadcast(broadcastId) {
  const [rows] = await db.query(
    'SELECT * FROM broadcasts WHERE id = ? LIMIT 1',
    [broadcastId]
  );
  if (!rows.length) return;
  const b = rows[0];

  const status = b.audience_status;
  let where = '';
  if (status === 'active') where = "WHERE c.status = 'active'";
  else if (status === 'suspended') where = "WHERE c.status = 'suspended'";

  const [clients] = await db.query(
    `SELECT c.id AS client_id, c.full_name, c.phone, c.sms_opt_out, u.email
       FROM clients c
       JOIN users u ON u.id = c.user_id
       ${where}
       ORDER BY c.id ASC`,
    []
  );

  const wantEmail = b.channels === 'email' || b.channels === 'both' || b.channels === 'all';
  const wantPush  = b.channels === 'push'  || b.channels === 'both' || b.channels === 'all';
  const wantSms   = b.channels === 'sms'   || b.channels === 'both' || b.channels === 'all';

  let emailSent = 0, emailFailed = 0, pushSent = 0, pushFailed = 0;
  let smsSent = 0, smsFailed = 0;

  for (let i = 0; i < clients.length; i += BATCH_SIZE) {
    const batch = clients.slice(i, i + BATCH_SIZE);

    for (const c of batch) {
      if (wantEmail && c.email) {
        try {
          await email.sendBroadcast(c.email, { subject: b.subject, body: b.body });
          emailSent++;
        } catch (err) {
          console.error('[broadcast email]', c.email, err.message);
          emailFailed++;
        }
      }
      if (wantPush) {
        try {
          const r = await push.sendToClient(c.client_id, {
            title: b.subject,
            body: b.body.slice(0, 200),
            url: '/client/dashboard',
            tag: 'broadcast-' + b.id,
          });
          if (r && r.sent > 0) pushSent += r.sent;
        } catch (err) {
          console.error('[broadcast push]', c.client_id, err.message);
          pushFailed++;
        }
      }
      if (wantSms && c.phone && !c.sms_opt_out) {
        try {
          const msg = ('ZARIA: ' + b.subject + ' — ' + b.body).substring(0, 160);
          const r = await ping.sendSms({ to: c.phone, message: msg, template: 'broadcast', clientId: c.client_id });
          if (r.ok) smsSent++;
          else smsFailed++;
        } catch (err) {
          console.error('[broadcast sms]', c.client_id, err.message);
          smsFailed++;
        }
      }
    }

    // Small delay between batches
    if (i + BATCH_SIZE < clients.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  await db.query(
    `UPDATE broadcasts
        SET email_sent_count = ?, email_failed_count = ?,
            push_sent_count = ?, push_failed_count = ?,
            sms_sent_count = ?, sms_failed_count = ?,
            status = 'completed', completed_at = NOW()
      WHERE id = ?`,
    [emailSent, emailFailed, pushSent, pushFailed, smsSent, smsFailed, broadcastId]
  );

  await audit.log({
    actorRole: 'system',
    action: 'broadcast.completed',
    entityType: 'broadcast',
    entityId: broadcastId,
    newValues: {
      email_sent: emailSent,
      email_failed: emailFailed,
      push_sent: pushSent,
      push_failed: pushFailed,
      sms_sent: smsSent,
      sms_failed: smsFailed,
    },
  });
}

async function getBroadcast(id) {
  const [rows] = await db.query(
    `SELECT b.*, u.email AS admin_email
       FROM broadcasts b
       JOIN users u ON u.id = b.sent_by
      WHERE b.id = ?
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function listBroadcasts({ limit = 50 } = {}) {
  const [rows] = await db.query(
    `SELECT b.*, u.email AS admin_email
       FROM broadcasts b
       JOIN users u ON u.id = b.sent_by
      ORDER BY b.started_at DESC
      LIMIT ?`,
    [limit]
  );
  return rows;
}

module.exports = {
  previewBroadcast,
  startBroadcast,
  getBroadcast,
  listBroadcasts,
};
