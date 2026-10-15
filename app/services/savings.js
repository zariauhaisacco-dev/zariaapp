/*
 * Zaria — Savings service
 *
 * Manages savings accounts and transactions. Every balance change is
 * recorded in savings_transactions with a `balance_after` snapshot —
 * that's the passbook, and it's immutable.
 */

const db = require('../db');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------
// Account management
// ---------------------------------------------------------------

function generateAccountNumber() {
  // SAV-<6-digit-random-until-unique>
  const rand = Math.floor(100000 + Math.random() * 900000);
  return 'SAV-' + rand;
}

async function createAccountForClient(clientId, conn) {
  const exec = conn || db;
  // Check if exists
  const [existing] = await exec.query(
    'SELECT id FROM savings_accounts WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  if (existing.length) return existing[0].id;

  // Try a few times in case of collision
  for (let i = 0; i < 5; i++) {
    const num = generateAccountNumber();
    try {
      const [result] = await exec.query(
        'INSERT INTO savings_accounts (client_id, account_number) VALUES (?, ?)',
        [clientId, num]
      );
      return result.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') continue;
      throw err;
    }
  }
  throw new Error('Could not generate unique account number');
}

async function getAccountByClient(clientId) {
  const [rows] = await db.query(
    `SELECT sa.*, c.full_name, c.phone, u.email
       FROM savings_accounts sa
       JOIN clients c ON c.id = sa.client_id
       JOIN users u ON u.id = c.user_id
      WHERE sa.client_id = ?
      LIMIT 1`,
    [clientId]
  );
  return rows[0] || null;
}

async function getAccountById(accountId) {
  const [rows] = await db.query(
    `SELECT sa.*, c.full_name, c.phone, u.email
       FROM savings_accounts sa
       JOIN clients c ON c.id = sa.client_id
       JOIN users u ON u.id = c.user_id
      WHERE sa.id = ?
      LIMIT 1`,
    [accountId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------

async function deposit({ savingsAccountId, amount, channel, mpesaReceipt, reference, notes, recordedBy }) {
  amount = round2(amount);
  if (!(amount > 0)) throw new Error('Amount must be positive');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, balance, status FROM savings_accounts WHERE id = ? FOR UPDATE',
      [savingsAccountId]
    );
    if (!rows.length) throw new Error('Savings account not found');
    if (rows[0].status !== 'active') throw new Error('Account is not active');

    const before = Number(rows[0].balance);
    const after = round2(before + amount);

    await conn.query(
      `UPDATE savings_accounts
          SET balance = ?, total_deposited = total_deposited + ?, last_transaction_at = NOW()
        WHERE id = ?`,
      [after, amount, savingsAccountId]
    );

    const [txResult] = await conn.query(
      `INSERT INTO savings_transactions
        (savings_account_id, type, amount, balance_after, channel, mpesa_receipt, reference, notes, status, recorded_by)
       VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [savingsAccountId, amount, after, channel || 'cash', mpesaReceipt || null, reference || null, notes || null, recordedBy || null]
    );

    await conn.commit();
    return { transactionId: txResult.insertId, newBalance: after };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function withdraw({ savingsAccountId, amount, channel, reference, notes, recordedBy, allowOverdraft }) {
  amount = round2(amount);
  if (!(amount > 0)) throw new Error('Amount must be positive');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, balance, status FROM savings_accounts WHERE id = ? FOR UPDATE',
      [savingsAccountId]
    );
    if (!rows.length) throw new Error('Savings account not found');
    if (rows[0].status === 'closed') throw new Error('Account is closed');

    const before = Number(rows[0].balance);
    if (before < amount && !allowOverdraft) {
      throw new Error('Insufficient balance. Available: KES ' + before.toFixed(2));
    }
    const after = round2(before - amount);

    await conn.query(
      `UPDATE savings_accounts
          SET balance = ?, total_withdrawn = total_withdrawn + ?, last_transaction_at = NOW()
        WHERE id = ?`,
      [after, amount, savingsAccountId]
    );

    const [txResult] = await conn.query(
      `INSERT INTO savings_transactions
        (savings_account_id, type, amount, balance_after, channel, reference, notes, status, recorded_by)
       VALUES (?, 'withdrawal', ?, ?, ?, ?, ?, 'completed', ?)`,
      [savingsAccountId, amount, after, channel || 'cash', reference || null, notes || null, recordedBy || null]
    );

    await conn.commit();
    return { transactionId: txResult.insertId, newBalance: after };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function creditInterest({ savingsAccountId, amount, notes }) {
  amount = round2(amount);
  if (!(amount > 0)) throw new Error('Interest amount must be positive');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, balance FROM savings_accounts WHERE id = ? FOR UPDATE',
      [savingsAccountId]
    );
    if (!rows.length) throw new Error('Savings account not found');

    const before = Number(rows[0].balance);
    const after = round2(before + amount);

    await conn.query(
      `UPDATE savings_accounts
          SET balance = ?, total_interest_earned = total_interest_earned + ?, last_transaction_at = NOW()
        WHERE id = ?`,
      [after, amount, savingsAccountId]
    );

    await conn.query(
      `INSERT INTO savings_transactions
        (savings_account_id, type, amount, balance_after, channel, notes, status)
       VALUES (?, 'interest', ?, ?, 'system', ?, 'completed')`,
      [savingsAccountId, amount, after, notes || 'Monthly interest']
    );

    await conn.commit();
    return { newBalance: after };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listTransactions(savingsAccountId, limit) {
  const [rows] = await db.query(
    `SELECT id, type, amount, balance_after, channel, mpesa_receipt, reference, notes, status, created_at
       FROM savings_transactions
      WHERE savings_account_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [savingsAccountId, limit || 100]
  );
  return rows;
}

// ---------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------

async function getPortfolioTotals() {
  const [rows] = await db.query(
    `SELECT
       COUNT(*) AS accounts,
       COALESCE(SUM(balance), 0) AS total_balance,
       COALESCE(SUM(total_deposited), 0) AS total_deposited,
       COALESCE(SUM(total_withdrawn), 0) AS total_withdrawn,
       COALESCE(SUM(total_interest_earned), 0) AS total_interest
     FROM savings_accounts
     WHERE status = 'active'`
  );
  return rows[0];
}

// ---------------------------------------------------------------
// Loan eligibility (based on savings balance)
// ---------------------------------------------------------------

async function getSettings() {
  const [rows] = await db.query('SELECT setting_key, setting_value FROM app_settings');
  const settings = {};
  rows.forEach(function (r) { settings[r.setting_key] = r.setting_value; });
  return {
    loan_multiplier: parseFloat(settings.loan_multiplier) || 3,
    min_savings_ratio: parseFloat(settings.min_savings_ratio) || 0.20,
    require_savings_for_loan: settings.require_savings_for_loan === '1',
  };
}

async function updateSetting(key, value, userId) {
  await db.query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [key, String(value), userId]
  );
}

async function getEligibilityForClient(clientId) {
  const settings = await getSettings();
  const account = await getAccountByClient(clientId);

  if (!account) {
    return {
      has_account: false,
      balance: 0,
      max_loan_amount: 0,
      settings: settings,
    };
  }

  const balance = Number(account.balance);
  const maxLoanAmount = round2(balance * settings.loan_multiplier);

  return {
    has_account: true,
    balance: balance,
    max_loan_amount: maxLoanAmount,
    settings: settings,
  };
}

async function checkLoanEligibility(clientId, requestedAmount) {
  const settings = await getSettings();

  if (!settings.require_savings_for_loan) {
    return { eligible: true, savings_required: false };
  }

  const account = await getAccountByClient(clientId);

  if (!account) {
    return {
      eligible: false,
      reason: 'You need a savings account to apply for a loan. Please contact us to open one.',
      max_allowed: 0,
      required_savings: round2(requestedAmount * settings.min_savings_ratio),
      current_savings: 0,
      settings: settings,
    };
  }

  const balance = Number(account.balance);
  const maxLoan = round2(balance * settings.loan_multiplier);
  const requiredSavings = round2(requestedAmount * settings.min_savings_ratio);

  if (requestedAmount > maxLoan) {
    return {
      eligible: false,
      reason: 'Your savings balance of KES ' + balance.toFixed(2) + ' entitles you to a maximum loan of KES ' + maxLoan.toFixed(2) + '.',
      max_allowed: maxLoan,
      required_savings: requiredSavings,
      current_savings: balance,
      settings: settings,
    };
  }

  if (balance < requiredSavings) {
    return {
      eligible: false,
      reason: 'You need at least KES ' + requiredSavings.toFixed(2) + ' in savings for a loan of KES ' + requestedAmount.toFixed(2) + '. You currently have KES ' + balance.toFixed(2) + '.',
      max_allowed: maxLoan,
      required_savings: requiredSavings,
      current_savings: balance,
      settings: settings,
    };
  }

  return {
    eligible: true,
    max_allowed: maxLoan,
    required_savings: requiredSavings,
    current_savings: balance,
    settings: settings,
  };
}

module.exports = {
  createAccountForClient,
  getAccountByClient,
  getAccountById,
  deposit,
  withdraw,
  creditInterest,
  listTransactions,
  getPortfolioTotals,
  getSettings,
  updateSetting,
  getEligibilityForClient,
  checkLoanEligibility,
};
