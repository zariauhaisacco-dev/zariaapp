const express = require('express');
const Joi = require('joi');
const db = require('../db');
const audit = require('../services/audit');
const savings = require('../services/savings');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// GET /api/admin/settings/products
router.get('/products', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, min_amount, max_amount, interest_rate, term_months, active FROM loan_products ORDER BY min_amount ASC'
    );
    res.json({ products: rows });
  } catch (err) {
    console.error('[settings products]', err.message);
    res.status(500).json({ error: 'Could not load products' });
  }
});

// POST /api/admin/settings/products/:id
const productSchema = Joi.object({
  min_amount: Joi.number().positive().max(10000000),
  max_amount: Joi.number().positive().max(10000000),
  interest_rate: Joi.number().min(0).max(0.99),
  term_months: Joi.number().integer().min(1).max(24),
  active: Joi.boolean(),
}).min(1);

router.post('/products/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const { error, value } = productSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const [existing] = await db.query('SELECT * FROM loan_products WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Product not found' });
    const before = existing[0];

    const updates = [];
    const params = [];
    ['min_amount', 'max_amount', 'interest_rate', 'term_months', 'active'].forEach(function (k) {
      if (value[k] !== undefined) {
        updates.push(k + ' = ?');
        params.push(value[k]);
      }
    });
    if (!updates.length) return res.json({ ok: true });

    params.push(id);
    await db.query('UPDATE loan_products SET ' + updates.join(', ') + ' WHERE id = ?', params);

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'product.updated',
      entityType: 'loan_product',
      entityId: id,
      oldValues: before,
      newValues: value,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[settings update product]', err.message);
    res.status(500).json({ error: 'Could not update product' });
  }
});

// GET /api/admin/settings/system
router.get('/system', async (req, res) => {
  try {
    const [users] = await db.query('SELECT COUNT(*) AS c FROM users');
    const [clients] = await db.query('SELECT COUNT(*) AS c FROM clients');
    const [loans] = await db.query('SELECT COUNT(*) AS c FROM loans');
    const [txs] = await db.query('SELECT COUNT(*) AS c FROM transactions');
    const [auditRows] = await db.query('SELECT COUNT(*) AS c FROM audit_logs');
    const [subs] = await db.query('SELECT COUNT(*) AS c FROM push_subscriptions');
    const [sessions] = await db.query('SELECT COUNT(*) AS c FROM sessions');
    const [migrations] = await db.query('SELECT COUNT(*) AS c FROM _migrations');
    const [dbSize] = await db.query(
      "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS mb FROM information_schema.TABLES WHERE table_schema = DATABASE()"
    );

    res.json({
      app: {
        name: 'Zaria',
        version: '1.0.0',
        env: process.env.NODE_ENV || 'development',
        started_at: new Date().toISOString(),
      },
      counts: {
        users: users[0].c,
        clients: clients[0].c,
        loans: loans[0].c,
        transactions: txs[0].c,
        audit_events: auditRows[0].c,
        push_subscriptions: subs[0].c,
        active_sessions: sessions[0].c,
        migrations: migrations[0].c,
      },
      db: { size_mb: Number(dbSize[0].mb) || 0 },
      features: {
        push: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        smtp: !!process.env.SMTP_PASS,
        daraja: !!process.env.DARAJA_CONSUMER_KEY,
        sms: !!process.env.AT_API_KEY,
      },
    });
  } catch (err) {
    console.error('[settings system]', err.message);
    res.status(500).json({ error: 'Could not load system info' });
  }
});


// GET /api/admin/settings/eligibility
router.get('/eligibility', async (req, res) => {
  try {
    const s = await savings.getSettings();
    res.json(s);
  } catch (err) {
    console.error('[settings eligibility get]', err.message);
    res.status(500).json({ error: 'Could not load settings' });
  }
});

// POST /api/admin/settings/eligibility
const eligSchema = Joi.object({
  loan_multiplier: Joi.number().positive().max(20).required(),
  min_savings_ratio: Joi.number().min(0).max(1).required(),
  require_savings_for_loan: Joi.boolean().required(),
});

router.post('/eligibility', async (req, res) => {
  const { error, value } = eligSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await savings.updateSetting('loan_multiplier', value.loan_multiplier, req.user.id, conn);
    await savings.updateSetting('min_savings_ratio', value.min_savings_ratio, req.user.id, conn);
    await savings.updateSetting('require_savings_for_loan', value.require_savings_for_loan ? '1' : '0', req.user.id, conn);

    await conn.commit();

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'settings.eligibility_updated',
      entityType: 'app_settings',
      newValues: value,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[settings eligibility update]', err.message);
    res.status(500).json({ error: 'Could not save settings' });
  } finally {
    conn.release();
  }
});

module.exports = router;
