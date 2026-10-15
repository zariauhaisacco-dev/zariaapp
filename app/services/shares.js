/*
 * Zaria — Shares service
 *
 * Manages share capital, holdings, and transactions.
 * Par value and limits are read from shares_config (single-row table).
 *
 * Core operations:
 *   - buyShares (cash or from savings)
 *   - redeemShares (at par)
 *   - transferShares (client A -> client B, admin approved)
 *   - getHoldingForClient
 *   - getPortfolioStats
 */

const db = require('../db');
const savings = require('./savings');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------

async function getConfig() {
  const [rows] = await db.query('SELECT * FROM shares_config WHERE id = 1 LIMIT 1');
  if (!rows.length) {
    // Defensive: return defaults if config row is missing
    return {
      par_value: 100,
      min_shares_per_member: 10,
      max_shares_per_member: 10000,
      allow_transfers: true,
      allow_savings_purchase: true,
    };
  }
  const c = rows[0];
  return {
    par_value: Number(c.par_value),
    min_shares_per_member: c.min_shares_per_member,
    max_shares_per_member: c.max_shares_per_member,
    allow_transfers: !!c.allow_transfers,
    allow_savings_purchase: !!c.allow_savings_purchase,
  };
}

async function updateConfig({ par_value, min_shares_per_member, max_shares_per_member, allow_transfers, allow_savings_purchase }, userId) {
  const updates = [];
  const params = [];
  const fields = { par_value, min_shares_per_member, max_shares_per_member, allow_transfers, allow_savings_purchase };
  Object.keys(fields).forEach(function (k) {
    if (fields[k] !== undefined) {
      updates.push(k + ' = ?');
      params.push(typeof fields[k] === 'boolean' ? (fields[k] ? 1 : 0) : fields[k]);
    }
  });
  if (!updates.length) return;
  updates.push('updated_by = ?');
  params.push(userId);
  await db.query('UPDATE shares_config SET ' + updates.join(', ') + ' WHERE id = 1', params);
}

// ---------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------

/**
 * Get or create the holding row for a client.
 * Never returns null for existing clients.
 */
async function getOrCreateHolding(clientId, conn) {
  const exec = conn || db;
  const [existing] = await exec.query(
    'SELECT * FROM share_holdings WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  if (existing.length) return existing[0];

  const [result] = await exec.query(
    'INSERT INTO share_holdings (client_id) VALUES (?)',
    [clientId]
  );
  const [rows] = await exec.query('SELECT * FROM share_holdings WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function getHoldingForClient(clientId) {
  const [rows] = await db.query(
    `SELECT sh.*, c.full_name, c.phone, u.email
       FROM share_holdings sh
       JOIN clients c ON c.id = sh.client_id
       JOIN users u ON u.id = c.user_id
      WHERE sh.client_id = ?
      LIMIT 1`,
    [clientId]
  );
  return rows[0] || null;
}

async function listTransactions(holdingId, limit) {
  const [rows] = await db.query(
    `SELECT id, type, shares, price_per_share, total_amount, shares_after,
            payment_source, counterparty_client_id, reference, notes, status, created_at
       FROM share_transactions
      WHERE holding_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [holdingId, limit || 100]
  );
  return rows;
}

// ---------------------------------------------------------------
// Buy shares
// ---------------------------------------------------------------

/**
 * Purchase shares for a client.
 * Options:
 *   - paymentSource: 'cash' (external), 'savings' (draws from savings balance)
 *   - shares: number of shares
 */
async function buyShares({ clientId, shares, paymentSource, reference, notes, recordedBy }) {
  shares = parseInt(shares, 10);
  if (!(shares > 0)) throw new Error('Shares must be a positive integer');

  const config = await getConfig();
  const totalAmount = round2(shares * config.par_value);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const holding = await getOrCreateHolding(clientId, conn);

    if (holding.shares_held + shares > config.max_shares_per_member) {
      throw new Error(
        'Purchase would exceed maximum holding of ' +
        config.max_shares_per_member + ' shares (currently ' + holding.shares_held + ')'
      );
    }

    // If paying from savings, deduct first
    if (paymentSource === 'savings') {
      if (!config.allow_savings_purchase) {
        throw new Error('Savings-based share purchase is not enabled');
      }
      const savAccount = await savings.getAccountByClient(clientId);
      if (!savAccount) throw new Error('No savings account found');
      if (Number(savAccount.balance) < totalAmount) {
        throw new Error('Insufficient savings balance. Available: KES ' + Number(savAccount.balance).toFixed(2));
      }

      // Withdraw from savings (its own transaction, separate connection)
      await savings.withdraw({
        savingsAccountId: savAccount.id,
        amount: totalAmount,
        channel: 'system',
        reference: reference || ('SHARES-' + Date.now()),
        notes: 'Share purchase — ' + shares + ' shares @ ' + config.par_value,
        recordedBy: recordedBy,
      });
    }

    const newShares = holding.shares_held + shares;
    const newInvested = round2(Number(holding.total_invested) + totalAmount);

    await conn.query(
      `UPDATE share_holdings
          SET shares_held = ?,
              total_purchased = total_purchased + ?,
              total_invested = ?,
              first_purchase_at = COALESCE(first_purchase_at, NOW()),
              last_transaction_at = NOW()
        WHERE id = ?`,
      [newShares, shares, newInvested, holding.id]
    );

    const [txResult] = await conn.query(
      `INSERT INTO share_transactions
        (holding_id, type, shares, price_per_share, total_amount, shares_after,
         payment_source, reference, notes, status, recorded_by)
       VALUES (?, 'purchase', ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [holding.id, shares, config.par_value, totalAmount, newShares,
       paymentSource || 'cash', reference || null, notes || null, recordedBy || null]
    );

    await conn.commit();
    return {
      transactionId: txResult.insertId,
      sharesBought: shares,
      totalAmount: totalAmount,
      newShareCount: newShares,
      parValue: config.par_value,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Redeem shares (client exits / partial)
// ---------------------------------------------------------------

async function redeemShares({ clientId, shares, reference, notes, recordedBy }) {
  shares = parseInt(shares, 10);
  if (!(shares > 0)) throw new Error('Shares must be a positive integer');

  const config = await getConfig();
  const totalAmount = round2(shares * config.par_value);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT * FROM share_holdings WHERE client_id = ? FOR UPDATE',
      [clientId]
    );
    if (!rows.length) throw new Error('No shareholding found');
    const holding = rows[0];

    if (holding.shares_held < shares) {
      throw new Error('Cannot redeem more shares than held. You hold ' + holding.shares_held + ' shares.');
    }

    const remaining = holding.shares_held - shares;
    if (remaining > 0 && remaining < config.min_shares_per_member) {
      throw new Error(
        'After redemption you would hold ' + remaining + ' shares, below the minimum of ' +
        config.min_shares_per_member + '. Redeem all shares or keep at least ' + config.min_shares_per_member + '.'
      );
    }

    await conn.query(
      `UPDATE share_holdings
          SET shares_held = ?,
              total_redeemed = total_redeemed + ?,
              total_redeemed_value = total_redeemed_value + ?,
              last_transaction_at = NOW()
        WHERE id = ?`,
      [remaining, shares, totalAmount, holding.id]
    );

    const [txResult] = await conn.query(
      `INSERT INTO share_transactions
        (holding_id, type, shares, price_per_share, total_amount, shares_after,
         payment_source, reference, notes, status, recorded_by)
       VALUES (?, 'redemption', ?, ?, ?, ?, 'system', ?, ?, 'completed', ?)`,
      [holding.id, shares, config.par_value, totalAmount, remaining,
       reference || null, notes || null, recordedBy || null]
    );

    await conn.commit();
    return {
      transactionId: txResult.insertId,
      sharesRedeemed: shares,
      totalAmount: totalAmount,
      newShareCount: remaining,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Transfer shares (client A -> client B)
// ---------------------------------------------------------------

async function transferShares({ fromClientId, toClientId, shares, reference, notes, recordedBy }) {
  shares = parseInt(shares, 10);
  if (!(shares > 0)) throw new Error('Shares must be a positive integer');
  if (fromClientId === toClientId) throw new Error('Cannot transfer shares to self');

  const config = await getConfig();
  if (!config.allow_transfers) throw new Error('Share transfers are disabled');

  const price = config.par_value;
  const totalAmount = round2(shares * price);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [fromRows] = await conn.query(
      'SELECT * FROM share_holdings WHERE client_id = ? FOR UPDATE',
      [fromClientId]
    );
    if (!fromRows.length) throw new Error('Sender has no shareholding');
    const from = fromRows[0];

    if (from.shares_held < shares) {
      throw new Error('Sender only holds ' + from.shares_held + ' shares');
    }
    const fromRemaining = from.shares_held - shares;
    if (fromRemaining > 0 && fromRemaining < config.min_shares_per_member) {
      throw new Error(
        'Sender would fall below minimum holding of ' + config.min_shares_per_member + ' shares'
      );
    }

    const to = await getOrCreateHolding(toClientId, conn);
    if (to.shares_held + shares > config.max_shares_per_member) {
      throw new Error('Recipient would exceed maximum holding of ' + config.max_shares_per_member + ' shares');
    }

    // Deduct from sender
    await conn.query(
      `UPDATE share_holdings
          SET shares_held = ?, last_transaction_at = NOW()
        WHERE id = ?`,
      [fromRemaining, from.id]
    );

    // Credit to recipient
    const newToShares = to.shares_held + shares;
    await conn.query(
      `UPDATE share_holdings
          SET shares_held = ?, last_transaction_at = NOW()
        WHERE id = ?`,
      [newToShares, to.id]
    );

    // Sender's transfer_out
    await conn.query(
      `INSERT INTO share_transactions
        (holding_id, type, shares, price_per_share, total_amount, shares_after,
         payment_source, counterparty_client_id, reference, notes, status, recorded_by)
       VALUES (?, 'transfer_out', ?, ?, ?, ?, 'system', ?, ?, ?, 'completed', ?)`,
      [from.id, shares, price, totalAmount, fromRemaining,
       toClientId, reference || null, notes || null, recordedBy || null]
    );

    // Recipient's transfer_in
    await conn.query(
      `INSERT INTO share_transactions
        (holding_id, type, shares, price_per_share, total_amount, shares_after,
         payment_source, counterparty_client_id, reference, notes, status, recorded_by)
       VALUES (?, 'transfer_in', ?, ?, ?, ?, 'system', ?, ?, ?, 'completed', ?)`,
      [to.id, shares, price, totalAmount, newToShares,
       fromClientId, reference || null, notes || null, recordedBy || null]
    );

    await conn.commit();
    return {
      sharesTransferred: shares,
      totalValue: totalAmount,
      fromRemaining: fromRemaining,
      toNewTotal: newToShares,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Portfolio stats (admin dashboard)
// ---------------------------------------------------------------

async function getPortfolioStats() {
  const [rows] = await db.query(
    `SELECT
       COUNT(*) AS members,
       COALESCE(SUM(shares_held), 0) AS total_shares,
       COALESCE(SUM(total_invested), 0) AS total_invested,
       COALESCE(SUM(total_redeemed_value), 0) AS total_redeemed
     FROM share_holdings
     WHERE shares_held > 0`
  );
  const config = await getConfig();
  const r = rows[0];
  return {
    members: r.members,
    total_shares: r.total_shares,
    total_invested: Number(r.total_invested),
    total_redeemed: Number(r.total_redeemed),
    share_capital: round2(r.total_shares * config.par_value),
    par_value: config.par_value,
  };
}

module.exports = {
  getConfig,
  updateConfig,
  getOrCreateHolding,
  getHoldingForClient,
  listTransactions,
  buyShares,
  redeemShares,
  transferShares,
  getPortfolioStats,
};
