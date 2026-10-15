/*
 * Zaria — Escalate overdue payments
 *
 * Runs daily at 9am EAT.
 * Sends escalating warnings at D+1, D+7, D+14, D+30.
 * One notice per stage per installment.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../db');
const email = require('../services/email');
const push = require('../services/push');

const STAGES = [1, 7, 14, 30];
const NEXT_STAGE = { 1: 7, 7: 14, 14: 30, 30: 9999999 };

(async () => {
  console.log('[escalate] start ' + new Date().toISOString());

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS escalation_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        loan_payment_id BIGINT UNSIGNED NOT NULL,
        stage_days INT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_payment_stage (loan_payment_id, stage_days),
        FOREIGN KEY (loan_payment_id) REFERENCES loan_payments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    let sent = 0;

    for (const stage of STAGES) {
      const [rows] = await db.query(
        `SELECT lp.id AS payment_id, lp.due_date, lp.amount_due, lp.amount_paid,
                DATEDIFF(CURDATE(), lp.due_date) AS days_overdue,
                l.id AS loan_id, l.client_id AS client_id,
                l.total_repayable, l.amount_repaid,
                c.full_name AS client_name,
                u.email AS client_email
           FROM loan_payments lp
           JOIN loans l ON l.id = lp.loan_id
           JOIN clients c ON c.id = l.client_id
           JOIN users u ON u.id = c.user_id
           LEFT JOIN escalation_log el ON el.loan_payment_id = lp.id AND el.stage_days = ?
          WHERE lp.status IN ('pending','partial','overdue')
            AND DATEDIFF(CURDATE(), lp.due_date) >= ?
            AND DATEDIFF(CURDATE(), lp.due_date) < ?
            AND l.status IN ('active','overdue')
            AND el.id IS NULL`,
        [stage, stage, NEXT_STAGE[stage]]
      );

      for (const r of rows) {
        const amountRemaining = Number(r.amount_due) - Number(r.amount_paid);
        const outstanding = Number(r.total_repayable) - Number(r.amount_repaid);

        try {
          await email.sendOverdueNotice(r.client_email, {
            client_name: r.client_name,
            amount_due: amountRemaining,
            days_overdue: r.days_overdue,
            loan_id: r.loan_id,
            outstanding: outstanding,
            stage: stage,
          });

          // Push notification (fire-and-forget)
          push.sendToClient(r.client_id, {
            title: 'Payment overdue',
            body: 'KES ' + Number(amountRemaining).toLocaleString() + ' is ' + r.days_overdue +
                  ' day' + (r.days_overdue === 1 ? '' : 's') + ' overdue. Loan #' + r.loan_id,
            url: '/client/loans/' + r.loan_id,
            tag: 'overdue-' + r.payment_id + '-' + stage,
          }).catch(function (e) { console.error('[escalate push]', e.message); });
          await db.query(
            'INSERT INTO escalation_log (loan_payment_id, stage_days) VALUES (?, ?)',
            [r.payment_id, stage]
          );
          sent++;
        } catch (e) {
          console.error('[escalate] send failed for payment ' + r.payment_id + ': ' + e.message);
        }
      }
    }

    console.log('[escalate] sent: ' + sent);
    process.exit(0);
  } catch (err) {
    console.error('[escalate] FAILED:', err.message);
    process.exit(1);
  }
})();
