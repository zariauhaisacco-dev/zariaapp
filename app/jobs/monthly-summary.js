/*
 * Zaria — Monthly summary email to admin
 *
 * Runs on the 1st of each month at 7am EAT.
 * Reports last month's activity.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../db');
const email = require('../services/email');

(async () => {
  console.log('[monthly] start ' + new Date().toISOString());

  try {
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_USER;
    if (!adminEmail) throw new Error('ADMIN_ALERT_EMAIL not configured');

    // Last month's range
    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [disbursed] = await db.query(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE type = 'disbursement' AND status = 'completed'
          AND created_at >= ? AND created_at < ?`,
      [lastMonthStart, thisMonthStart]
    );

    const [collected] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE type = 'repayment' AND status = 'completed'
          AND created_at >= ? AND created_at < ?`,
      [lastMonthStart, thisMonthStart]
    );

    const [repaid] = await db.query(
      `SELECT COUNT(*) AS c FROM loans
        WHERE status = 'repaid' AND closed_at >= ? AND closed_at < ?`,
      [lastMonthStart, thisMonthStart]
    );

    const [overdueCount] = await db.query(
      `SELECT COUNT(*) AS c FROM loans WHERE status = 'overdue'`
    );

    const [newClients] = await db.query(
      `SELECT COUNT(*) AS c FROM clients
        WHERE created_at >= ? AND created_at < ?`,
      [lastMonthStart, thisMonthStart]
    );

    const stats = {
      new_loans: disbursed[0].c,
      amount_disbursed: Number(disbursed[0].total),
      amount_collected: Number(collected[0].total),
      loans_repaid: repaid[0].c,
      loans_overdue: overdueCount[0].c,
      new_clients: newClients[0].c,
    };

    await email.sendAdminMonthlySummary(adminEmail, stats);
    console.log('[monthly] sent to ' + adminEmail);
    console.log('[monthly] stats:', JSON.stringify(stats));
    process.exit(0);
  } catch (err) {
    console.error('[monthly] FAILED:', err.message);
    process.exit(1);
  }
})();
