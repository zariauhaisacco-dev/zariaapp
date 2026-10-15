/*
 * Zaria — Send payment reminders
 *
 * Runs daily at 8am EAT.
 * Looks for pending installments due in 3 days, 1 day, or today.
 * Sends one reminder per installment per stage.
 * Idempotent: tracks sent reminders in a dedicated table.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../db');
const email = require('../services/email');
const push = require('../services/push');

const STAGES = [3, 1, 0]; // days until due

(async () => {
  console.log('[reminders] start ' + new Date().toISOString());

  try {
    // Ensure the tracking table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS reminder_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        loan_payment_id BIGINT UNSIGNED NOT NULL,
        stage_days INT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_payment_stage (loan_payment_id, stage_days),
        FOREIGN KEY (loan_payment_id) REFERENCES loan_payments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    let sent = 0;
    let skipped = 0;

    for (const stage of STAGES) {
      const [rows] = await db.query(
        `SELECT lp.id AS payment_id, lp.due_date, lp.amount_due, lp.amount_paid,
                l.id AS loan_id, l.client_id AS client_id,
                l.total_repayable, l.amount_repaid,
                c.full_name AS client_name,
                u.email AS client_email
           FROM loan_payments lp
           JOIN loans l ON l.id = lp.loan_id
           JOIN clients c ON c.id = l.client_id
           JOIN users u ON u.id = c.user_id
           LEFT JOIN reminder_log rl ON rl.loan_payment_id = lp.id AND rl.stage_days = ?
          WHERE lp.status IN ('pending','partial')
            AND DATEDIFF(lp.due_date, CURDATE()) = ?
            AND l.status IN ('active','overdue')
            AND rl.id IS NULL`,
        [stage, stage]
      );

      for (const r of rows) {
        const amountRemaining = Number(r.amount_due) - Number(r.amount_paid);
        const outstanding = Number(r.total_repayable) - Number(r.amount_repaid);

        try {
          await email.sendPaymentReminder(r.client_email, {
            client_name: r.client_name,
            amount_due: amountRemaining,
            due_date: r.due_date,
            days_until: stage,
            loan_id: r.loan_id,
            outstanding: outstanding,
          });

          // Push notification to the client's devices (fire-and-forget)
          push.sendToClient(r.client_id, {
            title: stage === 0 ? 'Payment due today' : 'Payment due ' + (stage === 1 ? 'tomorrow' : 'in ' + stage + ' days'),
            body: 'KES ' + Number(amountRemaining).toLocaleString() + ' due ' +
                  new Date(r.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
                  '. Loan #' + r.loan_id,
            url: '/client/loans/' + r.loan_id,
            tag: 'reminder-' + r.payment_id + '-' + stage,
          }).catch(function (e) { console.error('[reminders push]', e.message); });
          await db.query(
            'INSERT INTO reminder_log (loan_payment_id, stage_days) VALUES (?, ?)',
            [r.payment_id, stage]
          );
          sent++;
        } catch (e) {
          console.error('[reminders] send failed for payment ' + r.payment_id + ': ' + e.message);
        }
      }
    }

    console.log('[reminders] sent: ' + sent);
    console.log('[reminders] done');
    process.exit(0);
  } catch (err) {
    console.error('[reminders] FAILED:', err.message);
    process.exit(1);
  }
})();
