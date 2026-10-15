const express = require('express');
const Joi = require('joi');
const db = require('../db');
const savings = require('../services/savings');
const si      = require('../services/savings-interest');
const audit = require('../services/audit');
const push = require('../services/push');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// List all savings accounts
router.get('/accounts', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const where = [];
    const params = [];

    if (q) {
      where.push('(c.full_name LIKE ? OR c.phone LIKE ? OR sa.account_number LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like, like);
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT sa.id, sa.account_number, sa.balance, sa.total_deposited, sa.total_withdrawn,
              sa.total_interest_earned, sa.status, sa.opened_at, sa.last_transaction_at,
              c.id AS client_id, c.full_name, c.phone
         FROM savings_accounts sa
         JOIN clients c ON c.id = sa.client_id
         ${whereSql}
        ORDER BY sa.balance DESC
        LIMIT 500`,
      params
    );

    const [totals] = await db.query(
      `SELECT COUNT(*) AS accounts, COALESCE(SUM(balance), 0) AS total_balance FROM savings_accounts WHERE status = 'active'`
    );

    res.json({
      accounts: rows,
      totals: {
        accounts: totals[0].accounts,
        balance: Number(totals[0].total_balance),
      },
    });
  } catch (err) {
    console.error('[savings accounts]', err.message);
    res.status(500).json({ error: 'Could not load accounts' });
  }
});

// Get one account with its transactions
// Interest accrual summary (read-only, for admin dashboard)
router.get('/interest-summary', async (req, res, next) => {
  try {
    const summary = await si.getAccrualSummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get('/accounts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const account = await savings.getAccountById(id);
    if (!account) return res.status(404).json({ error: 'Not found' });

    const transactions = await savings.listTransactions(id, 200);
    res.json({ account, transactions });
  } catch (err) {
    console.error('[savings account]', err.message);
    res.status(500).json({ error: 'Could not load account' });
  }
});

// Create account for a client (if not exists)
router.post('/accounts/create', async (req, res) => {
  try {
    const clientId = Number(req.body.client_id);
    if (!clientId) return res.status(400).json({ error: 'client_id required' });

    const [client] = await db.query('SELECT id, full_name FROM clients WHERE id = ?', [clientId]);
    if (!client.length) return res.status(404).json({ error: 'Client not found' });

    const accountId = await savings.createAccountForClient(clientId);

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'savings.account_created',
      entityType: 'savings_account',
      entityId: accountId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, account_id: accountId });
  } catch (err) {
    console.error('[savings create]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Record deposit
const depositSchema = Joi.object({
  amount: Joi.number().positive().max(10000000).required(),
  channel: Joi.string().valid('cash', 'mpesa', 'bank', 'system').default('cash'),
  mpesa_receipt: Joi.string().max(50).allow('', null),
  reference: Joi.string().max(100).allow('', null),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/accounts/:id/deposit', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { error, value } = depositSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const account = await savings.getAccountById(id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const result = await savings.deposit({
      savingsAccountId: id,
      amount: value.amount,
      channel: value.channel,
      mpesaReceipt: value.mpesa_receipt,
      reference: value.reference,
      notes: value.notes,
      recordedBy: req.user.id,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'savings.deposit',
      entityType: 'savings_account',
      entityId: id,
      newValues: { amount: value.amount, channel: value.channel, new_balance: result.newBalance },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    push.notify(account.client_id, {
      title: 'Savings deposit',
      body: 'KES ' + Number(value.amount).toLocaleString() + ' added to your savings. Balance: KES ' + Number(result.newBalance).toLocaleString(),
      url: '/client/savings',
      tag: 'savings-deposit-' + result.transactionId,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[savings deposit]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Record withdrawal
const withdrawSchema = Joi.object({
  amount: Joi.number().positive().max(10000000).required(),
  channel: Joi.string().valid('cash', 'mpesa', 'bank', 'system').default('cash'),
  reference: Joi.string().max(100).allow('', null),
  notes: Joi.string().max(500).allow('', null),
  allow_overdraft: Joi.boolean().default(false),
});

router.post('/accounts/:id/withdraw', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { error, value } = withdrawSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const account = await savings.getAccountById(id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const result = await savings.withdraw({
      savingsAccountId: id,
      amount: value.amount,
      channel: value.channel,
      reference: value.reference,
      notes: value.notes,
      recordedBy: req.user.id,
      allowOverdraft: value.allow_overdraft,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'savings.withdrawal',
      entityType: 'savings_account',
      entityId: id,
      newValues: { amount: value.amount, channel: value.channel, new_balance: result.newBalance },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    push.notify(account.client_id, {
      title: 'Savings withdrawal',
      body: 'KES ' + Number(value.amount).toLocaleString() + ' withdrawn. Balance: KES ' + Number(result.newBalance).toLocaleString(),
      url: '/client/savings',
      tag: 'savings-withdrawal-' + result.transactionId,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[savings withdraw]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
