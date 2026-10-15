const express = require('express');
const Joi = require('joi');
const db = require('../db');
const shares = require('../services/shares');
const audit = require('../services/audit');
const push = require('../services/push');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ===============================================================
// CONFIG
// ===============================================================

router.get('/config', async (req, res) => {
  try {
    const config = await shares.getConfig();
    res.json(config);
  } catch (err) {
    console.error('[shares config]', err.message);
    res.status(500).json({ error: 'Could not load config' });
  }
});

const configSchema = Joi.object({
  par_value: Joi.number().positive().max(1000000),
  min_shares_per_member: Joi.number().integer().min(0).max(100000),
  max_shares_per_member: Joi.number().integer().min(1).max(1000000),
  allow_transfers: Joi.boolean(),
  allow_savings_purchase: Joi.boolean(),
}).min(1);

router.post('/config', async (req, res) => {
  try {
    const { error, value } = configSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const before = await shares.getConfig();
    await shares.updateConfig(value, req.user.id);

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'shares.config_updated',
      entityType: 'shares_config',
      entityId: 1,
      oldValues: before,
      newValues: value,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, config: await shares.getConfig() });
  } catch (err) {
    console.error('[shares config update]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ===============================================================
// PORTFOLIO
// ===============================================================

router.get('/portfolio', async (req, res) => {
  try {
    const stats = await shares.getPortfolioStats();
    res.json(stats);
  } catch (err) {
    console.error('[shares portfolio]', err.message);
    res.status(500).json({ error: 'Could not load portfolio' });
  }
});

// ===============================================================
// HOLDINGS — list + detail
// ===============================================================

router.get('/holdings', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const where = [];
    const params = [];

    if (q) {
      where.push('(c.full_name LIKE ? OR c.phone LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like);
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT sh.id, sh.client_id, sh.shares_held, sh.total_purchased,
              sh.total_redeemed, sh.total_invested, sh.total_redeemed_value,
              sh.first_purchase_at, sh.last_transaction_at,
              c.full_name, c.phone
         FROM share_holdings sh
         JOIN clients c ON c.id = sh.client_id
         ${whereSql}
         ORDER BY sh.shares_held DESC
         LIMIT 500`,
      params
    );

    const [config] = await Promise.all([shares.getConfig()]);
    const enriched = rows.map(function (r) {
      return {
        ...r,
        current_value: Math.round(r.shares_held * config.par_value * 100) / 100,
      };
    });

    res.json({ holdings: enriched, config: config });
  } catch (err) {
    console.error('[shares holdings]', err.message);
    res.status(500).json({ error: 'Could not load holdings' });
  }
});

router.get('/holdings/:clientId', async (req, res) => {
  try {
    const clientId = Number(req.params.clientId);
    if (!clientId) return res.status(400).json({ error: 'Invalid client id' });

    const holding = await shares.getHoldingForClient(clientId);
    if (!holding) return res.status(404).json({ error: 'No shareholding found' });

    const transactions = await shares.listTransactions(holding.id, 200);
    const config = await shares.getConfig();

    res.json({
      holding: {
        ...holding,
        current_value: Math.round(holding.shares_held * config.par_value * 100) / 100,
      },
      transactions: transactions,
      config: config,
    });
  } catch (err) {
    console.error('[shares holding]', err.message);
    res.status(500).json({ error: 'Could not load holding' });
  }
});

// ===============================================================
// TRANSACTIONS — buy / redeem / transfer
// ===============================================================

const buySchema = Joi.object({
  client_id: Joi.number().integer().positive().required(),
  shares: Joi.number().integer().positive().max(1000000).required(),
  payment_source: Joi.string().valid('cash', 'savings').default('cash'),
  reference: Joi.string().max(100).allow('', null),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/buy', async (req, res) => {
  try {
    const { error, value } = buySchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const result = await shares.buyShares({
      clientId: value.client_id,
      shares: value.shares,
      paymentSource: value.payment_source,
      reference: value.reference,
      notes: value.notes,
      recordedBy: req.user.id,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'shares.purchased',
      entityType: 'client',
      entityId: value.client_id,
      newValues: {
        shares: value.shares,
        amount: result.totalAmount,
        source: value.payment_source,
        new_total: result.newShareCount,
      },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    push.notify(value.client_id, {
      title: 'Shares purchased',
      body: value.shares + ' shares added (' + value.payment_source + '). You now hold ' + result.newShareCount + ' shares.',
      url: '/client/shares',
      tag: 'shares-buy-' + result.transactionId,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[shares buy]', err.message);
    res.status(400).json({ error: err.message });
  }
});

const redeemSchema = Joi.object({
  client_id: Joi.number().integer().positive().required(),
  shares: Joi.number().integer().positive().max(1000000).required(),
  reference: Joi.string().max(100).allow('', null),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/redeem', async (req, res) => {
  try {
    const { error, value } = redeemSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const result = await shares.redeemShares({
      clientId: value.client_id,
      shares: value.shares,
      reference: value.reference,
      notes: value.notes,
      recordedBy: req.user.id,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'shares.redeemed',
      entityType: 'client',
      entityId: value.client_id,
      newValues: {
        shares: value.shares,
        amount: result.totalAmount,
        new_total: result.newShareCount,
      },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    push.notify(value.client_id, {
      title: 'Shares redeemed',
      body: value.shares + ' shares redeemed. You now hold ' + result.newShareCount + ' shares.',
      url: '/client/shares',
      tag: 'shares-redeem-' + result.transactionId,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[shares redeem]', err.message);
    res.status(400).json({ error: err.message });
  }
});

const transferSchema = Joi.object({
  from_client_id: Joi.number().integer().positive().required(),
  to_client_id: Joi.number().integer().positive().required(),
  shares: Joi.number().integer().positive().max(1000000).required(),
  reference: Joi.string().max(100).allow('', null),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/transfer', async (req, res) => {
  try {
    const { error, value } = transferSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const result = await shares.transferShares({
      fromClientId: value.from_client_id,
      toClientId: value.to_client_id,
      shares: value.shares,
      reference: value.reference,
      notes: value.notes,
      recordedBy: req.user.id,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'shares.transferred',
      entityType: 'client',
      entityId: value.from_client_id,
      newValues: {
        from_client: value.from_client_id,
        to_client: value.to_client_id,
        shares: value.shares,
        value: result.totalValue,
      },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    push.notify(value.from_client_id, {
      title: 'Shares transferred out',
      body: value.shares + ' shares transferred. You now hold ' + result.fromRemaining + ' shares.',
      url: '/client/shares',
      tag: 'shares-out-' + Date.now(),
    });
    push.notify(value.to_client_id, {
      title: 'Shares transferred in',
      body: value.shares + ' shares received. You now hold ' + result.toNewTotal + ' shares.',
      url: '/client/shares',
      tag: 'shares-in-' + Date.now(),
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[shares transfer]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
