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
const notify = require('./notify');
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

      // Notify client
      if (reqRow.client_id) {
        const [acctRows] = await db.query('SELECT balance FROM savings_accounts WHERE id = ?', [reqRow.savings_account_id]);
        const newBal = acctRows.length ? Number(acctRows[0].balance) : 0;
        notify.alert({
          template: 'savings_deposit_received',
          clientId: reqRow.client_id,
          data: { amount, newBalance: newBal, receipt: mpesaReceipt },
        }).catch(function (e) { console.error('[notify savings deposit]', e.message); });
      }
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

      // Notify client
      if (reqRow.client_id) {
        const [loanRows] = await db.query('SELECT total_repayable, amount_repaid, status FROM loans WHERE id = ?', [reqRow.loan_id]);
        const loanData = loanRows.length ? loanRows[0] : {};
        const outstanding = Number(loanData.total_repayable || 0) - Number(loanData.amount_repaid || 0);
        const fullyRepaid = loanData.status === 'repaid';
        notify.alert({
          template: 'payment_received',
          clientId: reqRow.client_id,
          data: { amount, outstanding, fullyRepaid, receipt: mpesaReceipt, loanId: reqRow.loan_id },
        }).catch(function (e) { console.error('[notify loan payment]', e.message); });
      }
      return { recorded: true, target: 'loan' };
    }

    if (reqRow.chama_savings_account_id) {
      const chama = require('./chama');
      await chama.recordContributionByAccountId({
        chamaSavingsAccountId: reqRow.chama_savings_account_id,
        clientId: reqRow.client_id,
        amount,
        mpesaReceipt,
        reference: 'MPESA-STK-CHAMA',
        notes: 'M-Pesa STK chama contribution',
        recordedBy: null,
      });

      await audit.log({
        actorRole: 'system',
        action: 'daraja.chama_contribution_recorded',
        entityType: 'chama_savings_account',
        entityId: reqRow.chama_savings_account_id,
        newValues: {
          amount,
          mpesa_receipt: mpesaReceipt,
          checkout_request_id: reqRow.checkout_request_id,
          source: ctx.source || 'callback',
        },
        ip: ctx.ip || null,
        userAgent: ctx.userAgent || null,
      });

      // Notify client
      if (reqRow.client_id) {
        const [chamaAcctRows] = await db.query('SELECT c.name AS chama_name FROM chama_savings_accounts csa JOIN chamas c ON c.id = csa.chama_id WHERE csa.id = ?', [reqRow.chama_savings_account_id]);
        const chamaName = chamaAcctRows.length ? chamaAcctRows[0].chama_name : 'chama';
        const [contribRows] = await db.query('SELECT status FROM chama_contributions WHERE client_id = ? ORDER BY id DESC LIMIT 1', [reqRow.client_id]);
        const contribStatus = contribRows.length ? contribRows[0].status : 'paid';
        notify.alert({
          template: 'chama_contribution_received',
          clientId: reqRow.client_id,
          data: { amount, chamaName, status: contribStatus, receipt: mpesaReceipt },
        }).catch(function (e) { console.error('[notify chama contribution]', e.message); });
      }
      return { recorded: true, target: 'chama' };
    }

    if (reqRow.registration_fee_client_id) {
      // Mark fee paid + insert fee record
      await db.query(
        'UPDATE clients SET registration_fee_paid = 1, registration_fee_paid_at = NOW() WHERE id = ?',
        [reqRow.registration_fee_client_id]
      );
      await db.query(
        'INSERT INTO registration_fees (client_id, amount, channel, mpesa_receipt, status, recorded_by) VALUES (?, ?, ?, ?, ?, NULL)',
        [reqRow.registration_fee_client_id, amount, 'mpesa', mpesaReceipt, 'paid']
      );

      await audit.log({
        actorRole: 'system',
        action: 'registration_fee.paid',
        entityType: 'client',
        entityId: reqRow.registration_fee_client_id,
        newValues: { amount, mpesa_receipt: mpesaReceipt, checkout_request_id: reqRow.checkout_request_id },
        ip: ctx.ip || null,
        userAgent: ctx.userAgent || null,
      });

      // Notify client
      notify.alert({
        template: 'registration_fee_paid',
        clientId: reqRow.registration_fee_client_id,
        data: { amount, receipt: mpesaReceipt },
      }).catch(function (e) { console.error('[notify reg fee paid]', e.message); });

      return { recorded: true, target: 'registration_fee' };
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
