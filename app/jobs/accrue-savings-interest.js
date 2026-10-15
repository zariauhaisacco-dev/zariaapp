#!/usr/bin/env node
/*
 * Zaria — Savings interest cron job
 *
 * Runs daily at 01:30 UTC (04:30 EAT).
 *
 * Every day:
 *   1. Accrue interest for "yesterday" (UTC). One row per active savings
 *      account in savings_interest_accruals. Idempotent.
 *
 * On the 1st of each month:
 *   2. Post the previous month's accruals. This credits each account's
 *      balance via savings.creditInterest() and writes a savings_transactions
 *      row (type='interest', channel='system').
 *
 * Idempotency:
 *   - accrueForDate()    uses INSERT IGNORE on (account_id, accrual_date)
 *   - postMonth()        locks unposted rows with FOR UPDATE, flips to posted=1
 *   Re-running the same day is a no-op. Safe.
 *
 * Exit codes:
 *   0 — success
 *   1 — error (details printed to stderr and cron.log)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const si = require('../services/savings-interest');

function log(...args) {
  console.log('[savings-interest]', ...args);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const startedAt = Date.now();
  log(`start ${new Date(startedAt).toISOString()}`);

  // --- 1. Daily accrual for yesterday -----------------------------------
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const accrualDate = isoDate(yesterday);

  const acc = await si.accrueForDate(accrualDate);
  log(
    `accrued for ${acc.date}: ` +
    `processed=${acc.accountsProcessed} ` +
    `inserted=${acc.inserted} ` +
    `skipped=${acc.skippedMinBalance} ` +
    `total=${acc.totalAccrued}`
  );

  // --- 2. Monthly posting on the 1st ------------------------------------
  const now = new Date();
  if (now.getUTCDate() === 1) {
    const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const year  = prevMonth.getUTCFullYear();
    const month = prevMonth.getUTCMonth() + 1;

    log(`posting month ${year}-${String(month).padStart(2, '0')}`);
    const post = await si.postMonth(year, month);
    log(
      `posted ${year}-${String(month).padStart(2, '0')}: ` +
      `accounts=${post.accountsPosted} ` +
      `total=${post.totalPosted}`
    );
  } else {
    log('not 1st of month — skipping posting');
  }

  const elapsed = Date.now() - startedAt;
  log(`done in ${elapsed}ms`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[savings-interest] ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
