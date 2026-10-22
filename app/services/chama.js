/*
 * Zaria — Chama service
 *
 * Manages savings groups (chamas): creation, membership, monthly
 * contributions (min KES 300), chama savings accounts, and STK-push
 * crediting. Mirrors the transactional and audit patterns established
 * by services/savings.js and services/daraja-reconcile.js.
 *
 * Money flow:
 *   - Client → STK → M-Pesa → callback → chama.recordContribution()
 *   - Admin → cash → chama.recordContribution()
 *   Both land in chama_savings_transactions. Balance incremented atomically.
 *
 * Safety:
 *   - Every balance change wrapped in a transaction with FOR UPDATE lock
 *   - Every write is idempotent where required (chama_contributions unique key)
 *   - Audit log entry for every state-changing operation
 */

const db = require('../db');
const audit = require('./audit');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function currentPeriod() {
  // 'YYYY-MM' in EAT (UTC+3). Server runs UTC; chama is a Kenyan product.
  const now = new Date();
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = eat.getUTCFullYear();
  const m = eat.getUTCMonth() + 1;
  return y + '-' + (m < 10 ? '0' + m : String(m));
}

// ---------------------------------------------------------------
// Account number generation
// ---------------------------------------------------------------

async function nextAccountNumber(chamaId) {
  const padded = String(chamaId).padStart(4, '0');
  return 'CHM-' + padded;
}

// ---------------------------------------------------------------
// Create chama + auto-open savings account
// ---------------------------------------------------------------

async function createChama({ name, code, description, monthlyMin, timesMoneyEnabled, timesMoneyOrder, createdBy }) {
  if (!name || name.trim().length < 2) throw new Error('Chama name is required (min 2 chars)');
  if (!code || code.trim().length < 2) throw new Error('Chama code is required (min 2 chars)');
  if (!createdBy) throw new Error('createdBy is required');

  const monthly = round2(monthlyMin != null ? monthlyMin : 300);
  if (!(monthly > 0)) throw new Error('Monthly minimum must be positive');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Insert chama
    const [chamaResult] = await conn.query(
      `INSERT INTO chamas
         (name, code, description, status, monthly_contribution_min,
          times_money_enabled, times_money_order, created_by)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        name.trim(),
        code.trim().toUpperCase(),
        description ? description.trim() : null,
        monthly,
        timesMoneyEnabled ? 1 : 0,
        timesMoneyOrder || 'rotation',
        createdBy,
      ]
    );
    const chamaId = chamaResult.insertId;

    // Auto-open chama savings account
    const accountNumber = await nextAccountNumber(chamaId);
    const [acctResult] = await conn.query(
      `INSERT INTO chama_savings_accounts
         (chama_id, account_number, balance, total_contributed, total_withdrawn, status, opened_at)
       VALUES (?, ?, 0, 0, 0, 'active', NOW())`,
      [chamaId, accountNumber]
    );

    await conn.commit();

    await audit.log({
      actorRole: 'admin',
      action: 'chama.created',
      entityType: 'chama',
      entityId: chamaId,
      newValues: {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        monthly_contribution_min: monthly,
        savings_account_id: acctResult.insertId,
        account_number: accountNumber,
      },
    }).catch(function () {});

    return {
      chamaId,
      savingsAccountId: acctResult.insertId,
      accountNumber,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Enrol a member (link client + seed current period contribution)
// ---------------------------------------------------------------

async function enrolMember({ chamaId, clientId, enrolledBy }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lock chama row
    const [chamaRows] = await conn.query(
      'SELECT id, status, monthly_contribution_min FROM chamas WHERE id = ? FOR UPDATE',
      [chamaId]
    );
    if (!chamaRows.length) throw new Error('Chama not found');
    if (chamaRows[0].status !== 'active') throw new Error('Chama is not active');
    const monthlyMin = Number(chamaRows[0].monthly_contribution_min);

    // Lock client row + verify eligible
    const [clientRows] = await conn.query(
      'SELECT id, status, chama_id FROM clients WHERE id = ? FOR UPDATE',
      [clientId]
    );
    if (!clientRows.length) throw new Error('Client not found');
    if (clientRows[0].status !== 'active') throw new Error('Client is not active');
    if (clientRows[0].chama_id) throw new Error('Client already belongs to a chama');

    // Link
    await conn.query(
      'UPDATE clients SET chama_id = ? WHERE id = ?',
      [chamaId, clientId]
    );

    // Seed current-period contribution (idempotent via unique key)
    const period = currentPeriod();
    await conn.query(
      `INSERT INTO chama_contributions
         (chama_id, client_id, period, amount_due, amount_paid, status)
       VALUES (?, ?, ?, ?, 0, 'pending')
       ON DUPLICATE KEY UPDATE amount_due = VALUES(amount_due)`,
      [chamaId, clientId, period, monthlyMin]
    );

    await conn.commit();

    await audit.log({
      actorUserId: enrolledBy || null,
      actorRole: 'admin',
      action: 'chama.member_enrolled',
      entityType: 'chama',
      entityId: chamaId,
      newValues: { client_id: clientId, period, amount_due: monthlyMin },
    }).catch(function () {});

    return { chamaId, clientId, period, amountDue: monthlyMin };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Remove a member (unlink only, preserve history)
// ---------------------------------------------------------------

async function removeMember({ chamaId, clientId, removedBy }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, chama_id FROM clients WHERE id = ? FOR UPDATE',
      [clientId]
    );
    if (!rows.length) throw new Error('Client not found');
    if (Number(rows[0].chama_id) !== Number(chamaId)) {
      throw new Error('Client does not belong to this chama');
    }

    await conn.query('UPDATE clients SET chama_id = NULL WHERE id = ?', [clientId]);

    await conn.commit();

    await audit.log({
      actorUserId: removedBy || null,
      actorRole: 'admin',
      action: 'chama.member_removed',
      entityType: 'chama',
      entityId: chamaId,
      newValues: { client_id: clientId },
    }).catch(function () {});

    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Record a contribution (cash or M-Pesa) — the money-in operation
// ---------------------------------------------------------------

async function recordContribution({
  chamaId,
  clientId,
  amount,
  channel,
  mpesaReceipt,
  reference,
  notes,
  recordedBy,
}) {
  amount = round2(amount);
  if (!(amount > 0)) throw new Error('Amount must be positive');
  if (!clientId) throw new Error('clientId is required');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lock savings account (the money target)
    const [acctRows] = await conn.query(
      `SELECT id, balance, status
         FROM chama_savings_accounts
        WHERE chama_id = ? FOR UPDATE`,
      [chamaId]
    );
    if (!acctRows.length) throw new Error('Chama savings account not found');
    if (acctRows[0].status !== 'active') throw new Error('Chama savings account is not active');
    const acctId = acctRows[0].id;

    // Verify client is a member of this chama
    const [clientRows] = await conn.query(
      'SELECT id FROM clients WHERE id = ? AND chama_id = ? LIMIT 1',
      [clientId, chamaId]
    );
    if (!clientRows.length) throw new Error('Client is not a member of this chama');

    const before = Number(acctRows[0].balance);
    const after = round2(before + amount);

    // Update account balance
    await conn.query(
      `UPDATE chama_savings_accounts
          SET balance = ?, total_contributed = total_contributed + ?,
              last_transaction_at = NOW()
        WHERE id = ?`,
      [after, amount, acctId]
    );

    // Insert transaction row
    const [txResult] = await conn.query(
      `INSERT INTO chama_savings_transactions
         (chama_savings_account_id, client_id, type, amount, balance_after,
          channel, mpesa_receipt, reference, notes, status, recorded_by)
       VALUES (?, ?, 'contribution', ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [
        acctId, clientId, amount, after,
        channel || 'cash',
        mpesaReceipt || null,
        reference || null,
        notes || null,
        recordedBy || null,
      ]
    );

    // Update the current-period contribution record
    const period = currentPeriod();
    const [contribRows] = await conn.query(
      `SELECT id, amount_due, amount_paid FROM chama_contributions
        WHERE chama_id = ? AND client_id = ? AND period = ? FOR UPDATE`,
      [chamaId, clientId, period]
    );

    let contributionStatus = null;
    if (contribRows.length) {
      const c = contribRows[0];
      const newPaid = round2(Number(c.amount_paid) + amount);
      const due = Number(c.amount_due);
      const status = newPaid >= due ? 'paid' : 'partial';
      await conn.query(
        `UPDATE chama_contributions
            SET amount_paid = ?, status = ?, last_payment_at = NOW()
          WHERE id = ?`,
        [newPaid, status, c.id]
      );
      contributionStatus = status;
    } else {
      // No seed row (e.g. member was added after month started) — create one
      const [chamaCfg] = await conn.query(
        'SELECT monthly_contribution_min FROM chamas WHERE id = ?',
        [chamaId]
      );
      const due = Number(chamaCfg[0].monthly_contribution_min);
      const status = amount >= due ? 'paid' : 'partial';
      await conn.query(
        `INSERT INTO chama_contributions
           (chama_id, client_id, period, amount_due, amount_paid, status, last_payment_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [chamaId, clientId, period, due, amount, status]
      );
      contributionStatus = status;
    }

    await conn.commit();

    await audit.log({
      actorUserId: recordedBy || null,
      actorRole: recordedBy ? 'admin' : 'system',
      action: 'chama.contribution_recorded',
      entityType: 'chama',
      entityId: chamaId,
      newValues: {
        client_id: clientId,
        amount,
        channel: channel || 'cash',
        mpesa_receipt: mpesaReceipt || null,
        balance_after: after,
        contribution_status: contributionStatus,
        period,
      },
    }).catch(function () {});

    return {
      transactionId: txResult.insertId,
      newBalance: after,
      contributionStatus,
      period,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------
// Chama summary (for detail page)
// ---------------------------------------------------------------

async function getChamaSummary(chamaId) {
  const [chamaRows] = await db.query(
    `SELECT c.*, u.email AS created_by_email
       FROM chamas c
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.id = ? LIMIT 1`,
    [chamaId]
  );
  if (!chamaRows.length) throw new Error('Chama not found');
  const chama = chamaRows[0];

  const [acctRows] = await db.query(
    `SELECT id, account_number, balance, total_contributed, total_withdrawn,
            status, opened_at, last_transaction_at
       FROM chama_savings_accounts WHERE chama_id = ? LIMIT 1`,
    [chamaId]
  );
  const savingsAccount = acctRows[0] || null;

  const [members] = await db.query(
    `SELECT cl.id AS client_id, cl.full_name, cl.phone, cl.status,
            cc.period, cc.amount_due, cc.amount_paid, cc.status AS contribution_status,
            cc.last_payment_at
       FROM clients cl
       LEFT JOIN chama_contributions cc
         ON cc.client_id = cl.id AND cc.chama_id = cl.chama_id AND cc.period = ?
      WHERE cl.chama_id = ?
      ORDER BY cl.full_name ASC`,
    [currentPeriod(), chamaId]
  );

  const [recentTx] = await db.query(
    `SELECT t.id, t.client_id, cl.full_name AS client_name, t.type, t.amount,
            t.balance_after, t.channel, t.mpesa_receipt, t.created_at
       FROM chama_savings_transactions t
       LEFT JOIN clients cl ON cl.id = t.client_id
      WHERE t.chama_savings_account_id = ?
      ORDER BY t.id DESC
      LIMIT 20`,
    [savingsAccount ? savingsAccount.id : 0]
  );

  const period = currentPeriod();
  const paidThisPeriod = members.filter(function (m) { return m.contribution_status === 'paid'; }).length;

  return {
    chama,
    savingsAccount,
    members,
    recentTransactions: recentTx,
    currentPeriod: period,
    stats: {
      memberCount: members.length,
      paidThisPeriod,
      balance: savingsAccount ? Number(savingsAccount.balance) : 0,
      totalContributed: savingsAccount ? Number(savingsAccount.total_contributed) : 0,
    },
  };
}

// ---------------------------------------------------------------
// List chamas (for admin list page)
// ---------------------------------------------------------------

async function listChamas({ includeInactive }) {
  const where = includeInactive ? '' : "WHERE c.status = 'active'";
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.code, c.description, c.status,
            c.monthly_contribution_min, c.times_money_enabled,
            c.times_money_order, c.created_at,
            csa.account_number, csa.balance,
            (SELECT COUNT(*) FROM clients cl WHERE cl.chama_id = c.id) AS member_count
       FROM chamas c
       LEFT JOIN chama_savings_accounts csa ON csa.chama_id = c.id
       ${where}
       ORDER BY c.created_at DESC`,
    []
  );
  return rows;
}

// ---------------------------------------------------------------
// Update chama settings
// ---------------------------------------------------------------

async function updateChama({ chamaId, updates, updatedBy }) {
  const allowed = ['name', 'code', 'description', 'status', 'monthly_contribution_min',
                   'times_money_enabled', 'times_money_order'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (updates[k] !== undefined) {
      sets.push(k + ' = ?');
      params.push(updates[k]);
    }
  }
  if (!sets.length) throw new Error('No changes');
  params.push(chamaId);
  await db.query(`UPDATE chamas SET ${sets.join(', ')} WHERE id = ?`, params);

  await audit.log({
    actorUserId: updatedBy || null,
    actorRole: 'admin',
    action: 'chama.updated',
    entityType: 'chama',
    entityId: chamaId,
    newValues: updates,
  }).catch(function () {});

  return { ok: true };
}

// ---------------------------------------------------------------
// Soft-delete a chama
// ---------------------------------------------------------------

async function deactivateChama({ chamaId, deactivatedBy }) {
  await db.query(
    "UPDATE chamas SET status = 'inactive' WHERE id = ?",
    [chamaId]
  );

  await audit.log({
    actorUserId: deactivatedBy || null,
    actorRole: 'admin',
    action: 'chama.deactivated',
    entityType: 'chama',
    entityId: chamaId,
  }).catch(function () {});

  return { ok: true };
}

// ---------------------------------------------------------------
// Exports
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// Convenience: resolve chama by savings account, then record contribution.
// Used by daraja-reconcile.js where only chama_savings_account_id is known.
// ---------------------------------------------------------------

async function recordContributionByAccountId({
  chamaSavingsAccountId,
  clientId,
  amount,
  mpesaReceipt,
  reference,
  notes,
  recordedBy,
}) {
  const [rows] = await db.query(
    "SELECT chama_id FROM chama_savings_accounts WHERE id = ? LIMIT 1",
    [chamaSavingsAccountId]
  );
  if (!rows.length) throw new Error("Chama savings account not found");
  return recordContribution({
    chamaId: rows[0].chama_id,
    clientId,
    amount,
    channel: "mpesa",
    mpesaReceipt,
    reference,
    notes,
    recordedBy,
  });
}

// ---------------------------------------------------------------
// Times-money payouts (merry-go-round)
// ---------------------------------------------------------------

async function getNextRecipient(conn, chamaId) {
  const [chamaRows] = await conn.query(
    'SELECT id, times_money_enabled, times_money_order, times_money_next_client_id FROM chamas WHERE id = ? LIMIT 1',
    [chamaId]
  );
  if (!chamaRows.length) return null;
  const chama = chamaRows[0];
  if (!chama.times_money_enabled) return null;

  const [members] = await conn.query(
    'SELECT id FROM clients WHERE chama_id = ? AND status = "active" ORDER BY id ASC',
    [chamaId]
  );
  if (!members.length) return null;

  if (chama.times_money_next_client_id) {
    const found = members.find(m => m.id === chama.times_money_next_client_id);
    if (found) return found.id;
  }

  const [payouts] = await conn.query(
    'SELECT DISTINCT client_id FROM chama_savings_transactions WHERE chama_savings_account_id = (SELECT id FROM chama_savings_accounts WHERE chama_id = ?) AND type = "payout" AND status = "completed"',
    [chamaId]
  );
  const paidIds = new Set(payouts.map(p => p.client_id));
  for (const m of members) {
    if (!paidIds.has(m.id)) return m.id;
  }
  return members[0].id;
}

async function recordPayout({ chamaId, recipientClientId, amount, channel, mpesaReceipt, notes, recordedBy }) {
  amount = round2(amount);
  if (!(amount > 0)) throw new Error('Amount must be positive');
  if (!recipientClientId) throw new Error('recipientClientId is required');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [chamaRows] = await conn.query(
      'SELECT id, times_money_enabled FROM chamas WHERE id = ? FOR UPDATE',
      [chamaId]
    );
    if (!chamaRows.length) throw new Error('Chama not found');
    if (!chamaRows[0].times_money_enabled) throw new Error('Times-money is not enabled for this chama');

    const [acctRows] = await conn.query(
      'SELECT id, balance, status FROM chama_savings_accounts WHERE chama_id = ? FOR UPDATE',
      [chamaId]
    );
    if (!acctRows.length) throw new Error('Chama savings account not found');
    if (acctRows[0].status !== 'active') throw new Error('Chama savings account is not active');
    const acctId = acctRows[0].id;

    const [clientRows] = await conn.query(
      'SELECT id FROM clients WHERE id = ? AND chama_id = ? AND status = "active" LIMIT 1',
      [recipientClientId, chamaId]
    );
    if (!clientRows.length) throw new Error('Recipient is not an active member of this chama');

    const before = Number(acctRows[0].balance);
    if (amount > before) throw new Error('Insufficient chama balance. Available: KES ' + before.toFixed(2));
    const after = round2(before - amount);

    await conn.query(
      'UPDATE chama_savings_accounts SET balance = ?, total_withdrawn = total_withdrawn + ?, last_transaction_at = NOW() WHERE id = ?',
      [after, amount, acctId]
    );

    const [txResult] = await conn.query(
      `INSERT INTO chama_savings_transactions
         (chama_savings_account_id, client_id, type, amount, balance_after,
          channel, mpesa_receipt, reference, notes, status, recorded_by)
       VALUES (?, ?, 'payout', ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [acctId, recipientClientId, amount, after, channel || 'cash',
       mpesaReceipt || null, 'TIMES-MONEY', notes || null, recordedBy || null]
    );

    const [members] = await conn.query(
      'SELECT id FROM clients WHERE chama_id = ? AND status = "active" ORDER BY id ASC',
      [chamaId]
    );
    let nextId = null;
    if (members.length > 1) {
      const idx = members.findIndex(m => m.id === recipientClientId);
      if (idx !== -1) {
        nextId = members[(idx + 1) % members.length].id;
      } else {
        nextId = members[0].id;
      }
    } else if (members.length === 1) {
      nextId = members[0].id;
    }

    await conn.query(
      'UPDATE chamas SET times_money_next_client_id = ? WHERE id = ?',
      [nextId, chamaId]
    );

    await conn.commit();

    await audit.log({
      actorUserId: recordedBy || null,
      actorRole: 'admin',
      action: 'chama.payout_recorded',
      entityType: 'chama',
      entityId: chamaId,
      newValues: {
        recipient_client_id: recipientClientId,
        amount,
        channel: channel || 'cash',
        balance_after: after,
        next_rotation_client_id: nextId,
      },
    }).catch(function () {});

    // Notify payout recipient
    try {
      const notify = require('./notify');
      const [chamaInfo] = await db.query('SELECT name FROM chamas WHERE id = ?', [chamaId]);
      const chamaName = chamaInfo.length ? chamaInfo[0].name : 'your chama';
      notify.alert({
        template: 'chama_payout_received',
        clientId: recipientClientId,
        data: { amount, chamaName, mpesaReceipt },
      }).catch(function (e) { console.error('[notify chama payout]', e.message); });
    } catch (e) { console.error('[chama payout notify]', e.message); }

    return {
      transactionId: txResult.insertId,
      newBalance: after,
      nextRecipientClientId: nextId,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listPayouts(chamaId, { limit = 50 } = {}) {
  limit = Math.min(Number(limit) || 50, 200);
  const [rows] = await db.query(
    `SELECT t.id, t.client_id, c.full_name AS client_name, c.phone,
            t.amount, t.balance_after, t.channel, t.mpesa_receipt, t.notes,
            t.status, t.created_at
       FROM chama_savings_transactions t
       LEFT JOIN clients c ON c.id = t.client_id
      WHERE t.chama_savings_account_id = (SELECT id FROM chama_savings_accounts WHERE chama_id = ?)
        AND t.type = 'payout'
      ORDER BY t.id DESC
      LIMIT ?`,
    [chamaId, limit]
  );
  return rows;
}


module.exports = {
  createChama,
  enrolMember,
  removeMember,
  recordContribution,
  recordContributionByAccountId,
  getChamaSummary,
  listChamas,
  updateChama,
  deactivateChama,
  currentPeriod,
  getNextRecipient,
  recordPayout,
  listPayouts,
};
