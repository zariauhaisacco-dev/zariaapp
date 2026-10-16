/*
 * Zaria — Daraja reconciliation service
 *
 * Records the payment outcome for a daraja_requests row. Called from both the
 * callback handler and the reconcile-daraja cron job.
 *
 * Idempotent: uses UPDATE ... WHERE status = 'pending' to detect duplicate
 * calls. If affectedRows is 0, another path already recorded it.
 *
 * Handles two targets:
 *   - savings_account_id set → savings.deposit()
 *   - loan_id set             → loans.recordPayment()
 */

const db = require('../db');
const audit = require('./audit');
const loans = require('./loans');
const savings = require('./savings');

/**
 * Record a successful payment for a daraja_requests row.
 *
 * @param {Object} reqRow       - row from daraja_requests
 * @param {String} mpesaReceipt - M-Pesa receipt number (e.g. UJGH6AETR8)
 * @param {String} resultDesc   - Safaricom's result description
 * @param {Object} ctx          - optional { ip, userAgent }
 * @returns {Object}            - { recorded: bool, reason: string }
 */
async function recordSuccess(reqRow, mpesaReceipt, resultDesc, ctx) {
  ctx = ctx || {};

  // Mark as success atomically. If someone else already did, bail.
  const [markRes] = await db.query(
    `UPDATE daraja_requests
        SET status = 'success',
            result_code = 0,
            result_desc = ?,
            mpesa_receipt = ?
      WHERE id = ? AND status = 'pending'`,
    [resultDesc || 'Success', mpesaReceipt, reqRow.id]
  );

  if (!markRes.affectedRows) {
    return { recorded: false, reason: 'already_marked' };
  }

  const amount = Number(reqRow.amount);

  try {
    if (reqRow.savings_account_id) {
      await savings.deposit({
        savingsAccountId: reqRow.savings_account_id,
        amount,
        channel: 'mpesa',
        mpesaReceipt,
        reference: 'MPESA-STK',
        notes: 'M-Pesa STK savings',
        recordedBy: null,
      });

      await audit.log({
        actorRole: 'system',
        action: 'daraja.savings_deposit_recorded',
        entityType: 'savings_account',
        entityId: reqRow.savings_account_id,
        newValues: {
          amount,
          mpesa_receipt: mpesaReceipt,
          checkout_request_id: reqRow.checkout_request_id,
          source: ctx.source || 'callback',
        },
        ip: ctx.ip || null,
        userAgent: ctx.userAgent || null,
      });

      return { recorded: true, target: 'savings' };
    }

    if (reqRow.loan_id) {
      await loans.recordPayment({
        loanId: reqRow.loan_id,
        amount,
        mpesaReceipt,
        reference: 'MPESA-STK',
        notes: 'M-Pesa STK Push',
        recordedBy: null,
      });

      await audit.log({
        actorRole: 'system',
        action: 'daraja.payment_recorded',
        entityType: 'loan',
        entityId: reqRow.loan_id,
        newValues: {
          amount,
          mpesa_receipt: mpesaReceipt,
          checkout_request_id: reqRow.checkout_request_id,
          source: ctx.source || 'callback',
        },
        ip: ctx.ip || null,
        userAgent: ctx.userAgent || null,
      });

      return { recorded: true, target: 'loan' };
    }

    // Marked success but no target — unusual
    console.warn('[daraja-reconcile] success but no target for', reqRow.id);
    return { recorded: false, reason: 'no_target' };

  } catch (err) {
    // If crediting failed, revert the status so the next run retries.
    await db.query(
      "UPDATE daraja_requests SET status = 'pending', result_desc = ? WHERE id = ?",
      ['Credit failed: ' + err.message, reqRow.id]
    ).catch(function () {});
    throw err;
  }
}

/**
 * Mark a daraja_requests row as failed with a reason.
 */
async function recordFailure(reqRow, resultCode, resultDesc) {
  const [markRes] = await db.query(
    `UPDATE daraja_requests
        SET status = 'failed', result_code = ?, result_desc = ?
      WHERE id = ? AND status = 'pending'`,
    [resultCode, resultDesc, reqRow.id]
  );
  return { marked: markRes.affectedRows > 0 };
}

module.exports = {
  recordSuccess,
  recordFailure,
};
