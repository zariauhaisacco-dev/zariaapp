const express = require('express');
const Joi = require('joi');
const db = require('../db');
const dividends = require('../services/dividends');
const audit = require('../services/audit');
const push = require('../services/push');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ===============================================================
// PREVIEW — compute payouts for a given rate (no DB write)
// ===============================================================

const previewSchema = Joi.object({
  dividend_per_share: Joi.number().positive().max(1000000).required(),
});

router.post('/preview', async (req, res) => {
  try {
    const { error, value } = previewSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const preview = await dividends.previewDistribution(value.dividend_per_share);
    res.json(preview);
  } catch (err) {
    console.error('[dividends preview]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ===============================================================
// LIST
// ===============================================================

router.get('/', async (req, res) => {
  try {
    const list = await dividends.listDeclarations();
    res.json({ declarations: list });
  } catch (err) {
    console.error('[dividends list]', err.message);
    res.status(500).json({ error: 'Could not load declarations' });
  }
});

// ===============================================================
// GET ONE
// ===============================================================

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const result = await dividends.getDeclaration(id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    console.error('[dividends get]', err.message);
    res.status(500).json({ error: 'Could not load declaration' });
  }
});

// ===============================================================
// CREATE
// ===============================================================

const createSchema = Joi.object({
  financial_year: Joi.string().pattern(/^\d{4}(\/\d{4})?$/).required()
    .messages({ 'string.pattern.base': 'Financial year must be YYYY or YYYY/YYYY' }),
  dividend_per_share: Joi.number().positive().max(1000000).required(),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/', async (req, res) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const result = await dividends.createDeclaration({
      financialYear: value.financial_year,
      dividendPerShare: value.dividend_per_share,
      notes: value.notes,
      createdBy: req.user.id,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'dividend.declaration_created',
      entityType: 'dividend_declaration',
      entityId: result.declarationId,
      newValues: {
        financial_year: value.financial_year,
        dividend_per_share: value.dividend_per_share,
        total_payout: result.preview.total_gross,
      },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[dividends create]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ===============================================================
// DISTRIBUTE
// ===============================================================

const distributeSchema = Joi.object({
  credit_to_savings: Joi.boolean().default(true),
});

router.post('/:id/distribute', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { error, value } = distributeSchema.validate(req.body || {});
    if (error) return res.status(400).json({ error: error.details[0].message });

    const result = await dividends.distributeDeclaration({
      declarationId: id,
      creditToSavings: value.credit_to_savings !== false,
      adminUserId: req.user.id,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'dividend.distributed',
      entityType: 'dividend_declaration',
      entityId: id,
      newValues: {
        total_payouts: result.totalPayouts,
        credited: result.credited,
        failed: result.failed,
        credit_to_savings: value.credit_to_savings,
      },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Notify members who received credit
    if (value.credit_to_savings !== false) {
      const [decl] = await db.query(
        'SELECT financial_year, dividend_per_share FROM dividend_declarations WHERE id = ?',
        [id]
      );
      const [payouts] = await db.query(
        `SELECT dp.client_id, dp.net_amount
           FROM dividend_payouts dp
          WHERE dp.declaration_id = ? AND dp.status = 'credited'`,
        [id]
      );
      for (const p of payouts) {
        push.notify(p.client_id, {
          title: 'Dividend credited',
          body: 'KES ' + Number(p.net_amount).toLocaleString() + ' dividend credited to your savings (' +
                (decl[0] ? decl[0].financial_year : 'FY') + ').',
          url: '/client/dividends',
          tag: 'dividend-' + id + '-' + p.client_id,
        });
      }
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[dividends distribute]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ===============================================================
// CANCEL
// ===============================================================

router.post('/:id/cancel', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await dividends.cancelDeclaration(id);

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'dividend.cancelled',
      entityType: 'dividend_declaration',
      entityId: id,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[dividends cancel]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
