/*
 * Zaria — Expire stale pending registrations
 *
 * Runs daily at 3am EAT.
 * Any pending_registrations row older than 7 days is marked 'expired'.
 * Any row older than 30 days is deleted (ODPC retention).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../db');

(async () => {
  console.log('[expire-pending] start ' + new Date().toISOString());

  try {
    const [expired] = await db.query(
      `UPDATE pending_registrations
          SET status = 'expired'
        WHERE status = 'pending'
          AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
    console.log('[expire-pending] expired: ' + expired.affectedRows);

    const [deleted] = await db.query(
      `DELETE FROM pending_registrations
        WHERE status IN ('expired','rejected')
          AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );
    console.log('[expire-pending] deleted: ' + deleted.affectedRows);

    process.exit(0);
  } catch (err) {
    console.error('[expire-pending] FAILED:', err.message);
    process.exit(1);
  }
})();
