/*
 * Zaria — Savings interest accrual & posting
 *
 * Accrual: for each active savings account, compute one day's interest on the
 *          closing balance and write a row to savings_interest_accruals.
 *          Idempotent on (savings_account_id, accrual_date).
 *
 * Posting: sum a month's unposted accruals per account, credit the balance via
 *          savings.creditInterest() inside a per-account transaction, then
 *          mark those accruals posted with the resulting transaction id.
 *
 * Rate resolution: savings_accounts.interest_rate if > 0, else
 *                  app_settings.savings_interest_rate, else 0.05.
 *
 * No side effects on import. No timers, no connection opened at load.
 */

const db = require('../db');
const savings = require('./savings');

const DEFAULT_RATE = 0.05;
const DAYS_PER_YEAR = 365;

function round(n, dp) {
  const f = Math.pow(10, dp);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}

function isValidDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function todayUTC() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function getGlobalRate() {
  const [rows] = await db.query(
    `SELECT setting_value FROM app_settings WHERE setting_key = 'savings_interest_rate'`
  );
  if (!rows.length) return DEFAULT_RATE;
  const v = Number(rows[0].setting_value);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RATE;
}

async function getMinBalance() {
  const [rows] = await db.query(
    `SELECT setting_value FROM app_settings WHERE setting_key = 'savings_interest_min_balance'`
  );
  if (!rows.length) return 0;
  const v = Number(rows[0].setting_value);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function resolveRate(account, globalRate) {
  if (account && account.interest_rate != null) {
    const r = Number(account.interest_rate);
    if (Number.isFinite(r) && r > 0) return r;
  }
  return Number.isFinite(globalRate) && globalRate > 0 ? globalRate : DEFAULT_RATE;
}

/*
 * accrueForDate('YYYY-MM-DD')
 * Returns: { date, accountsProcessed, inserted, skippedMinBalance, totalAccrued }
 */
async function accrueForDate(dateStr) {
  if (!dateStr) dateStr = todayUTC();
  if (!isValidDateStr(dateStr)) throw new Error('accrueForDate: date must be YYYY-MM-DD');

  const globalRate = await getGlobalRate();
  const minBalance = await getMinBalance();

  const [accounts] = await db.query(
    `SELECT id, balance, interest_rate
       FROM savings_accounts
      WHERE status = 'active'`
  );

  let inserted = 0;
  let skippedMinBalance = 0;
  let totalAccrued = 0;

  for (const acct of accounts) {
    const balance = Number(acct.balance);
    if (!(balance > 0) || balance < minBalance) {
      skippedMinBalance++;
      continue;
    }
    const rate = resolveRate(acct, globalRate);
    const daily = round(balance * rate / DAYS_PER_YEAR, 4);
    if (!(daily > 0)) {
      skippedMinBalance++;
      continue;
    }
    const [res] = await db.query(
      `INSERT IGNORE INTO savings_interest_accruals
        (savings_account_id, accrual_date, closing_balance, daily_interest, rate_applied)
       VALUES (?, ?, ?, ?, ?)`,
      [acct.id, dateStr, round(balance, 2), daily, rate]
    );
    if (res.affectedRows === 1) {
      inserted++;
      totalAccrued = round(totalAccrued + daily, 4);
    }
  }

  return {
    date: dateStr,
    accountsProcessed: accounts.length,
    inserted,
    skippedMinBalance,
    totalAccrued: round(totalAccrued, 4),
  };
}

/*
 * postMonth(year, month)
 * month is 1..12. Posts all unposted accruals whose accrual_date falls in that
 * calendar month. Idempotent — posting again is a no-op because rows are
 * flipped to posted=1.
 *
 * Returns: { year, month, accountsPosted, totalPosted, postings: [{accountId, amount, txnId}] }
 */
async function postMonth(year, month) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error('postMonth: bad year');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('postMonth: bad month');

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const [groups] = await db.query(
    `SELECT savings_account_id,
            SUM(daily_interest) AS accrued,
            COUNT(*) AS days,
            MIN(accrual_date) AS first_day,
            MAX(accrual_date) AS last_day
       FROM savings_interest_accruals
      WHERE posted = 0
        AND accrual_date >= ?
        AND accrual_date <  ?
      GROUP BY savings_account_id
      HAVING accrued > 0`,
    [startDate, endDate]
  );

  const postings = [];
  let totalPosted = 0;

  for (const g of groups) {
    const accountId = g.savings_account_id;
    const amount = round(g.accrued, 2);
    if (!(amount > 0)) continue;

    // Lock the accrual rows for this account+month so a concurrent run can't
    // pick them up.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [lockRows] = await conn.query(
        `SELECT id FROM savings_interest_accruals
          WHERE savings_account_id = ?
            AND posted = 0
            AND accrual_date >= ?
            AND accrual_date <  ?
          FOR UPDATE`,
        [accountId, startDate, endDate]
      );
      if (!lockRows.length) {
        await conn.rollback();
        conn.release();
        continue;
      }

      const note = `Interest for ${startDate.slice(0, 7)} (${g.days} day${g.days === 1 ? '' : 's'})`;
      const result = await savings.creditInterest({
        savingsAccountId: accountId,
        amount,
        notes: note,
      });

      const [txnRows] = await conn.query(
        `SELECT id FROM savings_transactions
          WHERE savings_account_id = ?
            AND type = 'interest'
          ORDER BY id DESC LIMIT 1`,
        [accountId]
      );
      const txnId = txnRows.length ? txnRows[0].id : null;

      const ids = lockRows.map(r => r.id);
      await conn.query(
        `UPDATE savings_interest_accruals
            SET posted = 1, posted_transaction_id = ?
          WHERE id IN (?)`,
        [txnId, ids]
      );

      await conn.commit();
      postings.push({ accountId, amount, txnId, days: g.days });
      totalPosted = round(totalPosted + amount, 2);
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      conn.release();
      throw err;
    } finally {
      try { conn.release(); } catch (_) {}
    }
  }

  return {
    year,
    month,
    accountsPosted: postings.length,
    totalPosted,
    postings,
  };
}

/*
 * getAccrualSummary()
 * For the admin card. Read-only.
 */
async function getAccrualSummary() {
  const [unpostedRows] = await db.query(
    `SELECT COALESCE(SUM(daily_interest), 0) AS total,
            MIN(accrual_date) AS oldest
       FROM savings_interest_accruals
      WHERE posted = 0`
  );

  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;

  const [postedRows] = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
       FROM savings_transactions
      WHERE type = 'interest'
        AND status = 'completed'
        AND created_at >= ?`,
    [monthStart]
  );

  const [earningRows] = await db.query(
    `SELECT COUNT(*) AS n FROM savings_accounts
      WHERE status = 'active' AND balance > 0`
  );

  const nextPost = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    unpostedTotal: round(unpostedRows[0].total, 2),
    oldestUnpostedDate: unpostedRows[0].oldest,
    postedThisMonth: round(postedRows[0].total, 2),
    postedThisMonthCount: postedRows[0].n,
    accountsEarning: earningRows[0].n,
    nextPostDate: nextPost.toISOString().slice(0, 10),
  };
}

module.exports = {
  DEFAULT_RATE,
  resolveRate,
  accrueForDate,
  postMonth,
  getAccrualSummary,
};
