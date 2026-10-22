#!/usr/bin/env node
/*
 * Zaria — Reconcile Daraja requests
 *
 * Runs every 5 minutes.
 *
 * For each daraja_requests row with status='pending' that's older than 2
 * minutes (but less than 24 hours), query Safaricom via stkQuery to find
 * the actual outcome. If the payment succeeded and the callback was lost,
 * credit the target (loan or savings). If Safaricom definitively failed
 * it, mark it failed. If still processing, leave for next run.
 *
 * Also marks anything pending for more than 24 hours as 'timeout'.
 *
 * Idempotent — safe to run manually.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('../db');
const daraja = require('../services/daraja');
const reconcile = require('../services/daraja-reconcile');

function log(...args) {
  console.log('[reconcile-daraja]', ...args);
}

async function main() {
  if (!(await daraja.isConfigured())) {
    log('skipped — Daraja not configured');
    return;
  }

  const startedAt = Date.now();
  log('start', new Date(startedAt).toISOString());

  // 1. Find pending requests old enough to reconcile
  const [pending] = await db.query(
    `SELECT id, client_id, loan_id, savings_account_id, chama_savings_account_id, checkout_request_id,
            phone, amount, status, created_at
       FROM daraja_requests
      WHERE status = 'pending'
        AND direction = 'stk_push'
        AND created_at <= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
        AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY id ASC
      LIMIT 50`
  );

  log('pending to reconcile:', pending.length);

  let successCount = 0;
  let failedCount = 0;
  let stillPending = 0;
  let errorCount = 0;

  for (const row of pending) {
    try {
      const q = await daraja.stkQuery({ checkoutRequestId: row.checkout_request_id });

      if (q.resultCode === 0) {
        // Success at Safaricom's side. Extract receipt from the query response.
        const receipt = (q.raw && q.raw.MpesaReceiptNumber) || null;
        if (!receipt) {
          // ResultCode 0 but no receipt — unusual. Log and skip.
          log('SUCCESS but no receipt for', row.checkout_request_id);
          stillPending++;
          continue;
        }

        await reconcile.recordSuccess(row, receipt, 'Reconciled via cron', {
          source: 'cron',
        });
        successCount++;
        log('✅ reconciled success:', row.checkout_request_id, 'receipt:', receipt, 'amount:', row.amount);

      } else if (q.resultCode === 4999) {
        // Still processing at Safaricom's side
        stillPending++;
        log('⏳ still processing:', row.checkout_request_id);

      } else if (q.resultCode == null && q.raw && q.raw.errorCode) {
        // Query itself failed — Safaricom doesn't know this CheckoutRequestID
        // Treat as still pending; the query may work on the next run
        stillPending++;
        log('⚠️ query error for', row.checkout_request_id, ':', q.raw.errorCode);

      } else {
        // Definitive failure (user cancelled, timeout, insufficient funds, etc.)
        await reconcile.recordFailure(row, q.resultCode, q.resultDesc || 'Reconciliation found failure');
        failedCount++;
        log('❌ reconciled failure:', row.checkout_request_id, 'code:', q.resultCode, 'desc:', q.resultDesc);
      }

    } catch (err) {
      errorCount++;
      log('⚠️ exception for', row.checkout_request_id, ':', err.message);
      // Leave as pending — retry next run
    }
  }

  // 2. Mark very old pending requests as 'timeout'
  const [timedOut] = await db.query(
    `UPDATE daraja_requests
        SET status = 'timeout',
            result_desc = 'Expired — no callback and not resolvable via stkQuery'
      WHERE status = 'pending'
        AND direction = 'stk_push'
        AND created_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
  );

  const elapsed = Date.now() - startedAt;
  log(`done in ${elapsed}ms — success=${successCount} failed=${failedCount} pending=${stillPending} timeout=${timedOut.affectedRows} errors=${errorCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[reconcile-daraja] FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
