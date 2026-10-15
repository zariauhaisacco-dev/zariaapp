/*
 * Zaria — Web push notifications
 *
 * Uses VAPID (Voluntary Application Server Identification) to send pushes.
 * Subscriptions are stored per client device in push_subscriptions.
 * Dead subscriptions (410 Gone) are auto-pruned.
 */

const webpush = require('web-push');
const db = require('../db');

let configured = false;

function configure() {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:info@zariauhai.com';

  if (!pub || !priv) {
    console.warn('[push] VAPID keys not configured');
    return false;
  }

  webpush.setVapidDetails(subj, pub, priv);
  configured = true;
  return true;
}

/**
 * Save or update a subscription for a client.
 */
async function subscribe(clientId, subscription, userAgent) {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    throw new Error('Invalid subscription');
  }
  await db.query(
    `INSERT INTO push_subscriptions (client_id, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent)`,
    [clientId, endpoint, keys.p256dh, keys.auth, (userAgent || '').substring(0, 255)]
  );
}

/**
 * Remove a subscription by endpoint.
 */
async function unsubscribe(clientId, endpoint) {
  await db.query(
    'DELETE FROM push_subscriptions WHERE client_id = ? AND endpoint = ?',
    [clientId, endpoint]
  );
}

/**
 * Send a push to every device of one client.
 * Auto-removes subscriptions that respond 410/404 (device gone).
 */
async function sendToClient(clientId, payload) {
  if (!configure()) return { sent: 0, removed: 0 };

  const [rows] = await db.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE client_id = ?',
    [clientId]
  );
  if (!rows.length) return { sent: 0, removed: 0 };

  let sent = 0;
  let removed = 0;

  for (const row of rows) {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      await db.query('UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = ?', [row.id]);
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.query('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
        removed++;
      } else {
        console.error('[push] send failed for sub ' + row.id + ': ' + err.message);
      }
    }
  }

  return { sent, removed };
}

/**
 * Fire-and-forget helper for use inside request handlers.
 */
function notify(clientId, payload) {
  sendToClient(clientId, payload).catch(e => console.error('[push notify]', e.message));
}

module.exports = {
  subscribe,
  unsubscribe,
  sendToClient,
  notify,
  configure,
};
