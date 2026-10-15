/*
 * Zaria — Mark overdue payments
 *
 * Runs daily at 6am EAT.
 * - Flips pending installments past their due date to 'overdue'
 * - Flips loans with any overdue installment to 'overdue'
 * - Pushes a notification to affected clients
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../db');
const loans = require('../services/loans');
const push = require('../services/push');

(async () => {
  const started = new Date();
  console.log('[mark-overdue] start ' + started.toISOString());

  try {
    // 1. Snapshot which loans are currently active (not overdue) but have a payment
    //    that just went past due. We use this to send a one-time push.
    const [justBecameOverdue] = await db.query(
      `SELECT DISTINCT l.id AS loan_id, l.client_id, c.full_name,
              (SELECT SUM(lp.amount_due - lp.amount_paid)
                 FROM loan_payments lp
                WHERE lp.loan_id = l.id AND lp.status IN ('pending','partial')
                  AND lp.due_date < CURDATE()) AS amount_overdue
         FROM loans l
         JOIN clients c ON c.id = l.client_id
        WHERE l.status = 'active'
          AND EXISTS (
            SELECT 1 FROM loan_payments lp
             WHERE lp.loan_id = l.id
               AND lp.status IN ('pending','partial')
               AND lp.due_date < CURDATE()
          )`
    );

    console.log('[mark-overdue] loans about to flip: ' + justBecameOverdue.length);

    // 2. Flip installments and loans
    const result = await loans.markOverduePayments();
    console.log('[mark-overdue] installments flagged: ' + result.installmentsFlagged);
    console.log('[mark-overdue] loans flagged: ' + result.loansFlagged);

    // 3. Push to each affected client (fire-and-forget)
    for (const row of justBecameOverdue) {
      push.sendToClient(row.client_id, {
        title: 'Loan overdue',
        body: 'Your loan #' + row.loan_id + ' is now overdue by KES ' +
              Number(row.amount_overdue || 0).toLocaleString() + '. Please pay to avoid further action.',
        url: '/client/loans/' + row.loan_id,
        tag: 'overdue-start-' + row.loan_id,
      }).catch(function (e) { console.error('[mark-overdue push]', e.message); });
    }

    // 4. Auto-close loans that are fully repaid but stuck in active/overdue
    const [fixups] = await db.query(
      `UPDATE loans
          SET status = 'repaid', closed_at = NOW()
        WHERE status IN ('active', 'overdue')
          AND amount_repaid >= total_repayable - 0.01`
    );
    if (fixups.affectedRows) {
      console.log('[mark-overdue] loans auto-closed: ' + fixups.affectedRows);
    }

    const elapsed = Date.now() - started.getTime();
    console.log('[mark-overdue] done in ' + elapsed + 'ms');
    process.exit(0);
  } catch (err) {
    console.error('[mark-overdue] FAILED:', err.message);
    process.exit(1);
  }
})();
