/*
 * Zaria — Chama admin routes
 *
 * Mounted at /api/admin/chamas in server.js.
 *
 * Endpoints:
 *   GET    /                          list chamas (+ member counts)
 *   POST   /                          create chama (auto-opens savings account)
 *   GET    /:id                       detail (summary + members + recent tx)
 *   PATCH  /:id                       update settings (name, code, status, etc.)
 *   DELETE /:id                       soft-delete (status = inactive)
 *
 *   GET    /:id/members               list members + this period status
 *   POST   /:id/members               enrol client (seeds current period row)
 *   DELETE /:id/members/:clientId     unlink member (history preserved)
 *
 *   GET    /:id/contributions         list all contributions
 *   POST   /:id/contributions         record cash contribution
 *
 *   GET    /:id/transactions          chama savings ledger
 *
 *   POST   /:id/invites               create invite (Stage 5 — returns 501 for now)
 *   DELETE /:id/invites/:inviteId     cancel invite (Stage 5)
 */

const express = require('express');
const Joi = require('joi');
const db = require('../db');
const chama = require('../services/chama');
const audit = require('../services/audit');
const email = require('../services/email');
const notify = require('../services/notify');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ---------------------------------------------------------------
// List chamas
// ---------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const includeInactive = req.query.include_inactive === '1';
    const list = await chama.listChamas({ includeInactive });
    res.json({ chamas: list });
  } catch (err) {
    console.error('[admin-chama list]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Create chama
// ---------------------------------------------------------------
const createSchema = Joi.object({
  name: Joi.string().min(2).max(150).required(),
  code: Joi.string().min(2).max(20).pattern(/^[A-Za-z0-9_-]+$/).required()
    .messages({ 'string.pattern.base': 'Code may contain letters, digits, hyphen, underscore only' }),
  description: Joi.string().max(500).allow('', null),
  monthly_contribution_min: Joi.number().positive().max(10000000).default(300),
  times_money_enabled: Joi.boolean().default(false),
  times_money_order: Joi.string().valid('rotation', 'fixed', 'random').default('rotation'),
});

router.post('/', async (req, res, next) => {
  try {
    const { error, value } = createSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Invalid input',
        details: error.details.map(function (d) { return { field: d.path.join('.'), message: d.message }; }),
      });
    }
    const result = await chama.createChama({
      name: value.name,
      code: value.code,
      description: value.description,
      monthlyMin: value.monthly_contribution_min,
      timesMoneyEnabled: value.times_money_enabled,
      timesMoneyOrder: value.times_money_order,
      createdBy: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Code already in use' });
    }
    console.error('[admin-chama create]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Detail
// ---------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const summary = await chama.getChamaSummary(id);
    res.json(summary);
  } catch (err) {
    if (err.message === 'Chama not found') return res.status(404).json({ error: 'Chama not found' });
    console.error('[admin-chama detail]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Update
// ---------------------------------------------------------------
const updateSchema = Joi.object({
  name: Joi.string().min(2).max(150),
  code: Joi.string().min(2).max(20).pattern(/^[A-Za-z0-9_-]+$/),
  description: Joi.string().max(500).allow('', null),
  status: Joi.string().valid('active', 'inactive'),
  monthly_contribution_min: Joi.number().positive().max(10000000),
  times_money_enabled: Joi.boolean(),
  times_money_order: Joi.string().valid('rotation', 'fixed', 'random'),
}).min(1);

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const { error, value } = updateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Invalid input',
        details: error.details.map(function (d) { return { field: d.path.join('.'), message: d.message }; }),
      });
    }
    await chama.updateChama({ chamaId: id, updates: value, updatedBy: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Code already in use' });
    console.error('[admin-chama update]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Soft-delete
// ---------------------------------------------------------------
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    await chama.deactivateChama({ chamaId: id, deactivatedBy: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin-chama deactivate]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Members — list
// ---------------------------------------------------------------
router.get('/:id/members', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const summary = await chama.getChamaSummary(id);
    res.json({ members: summary.members, currentPeriod: summary.currentPeriod });
  } catch (err) {
    if (err.message === 'Chama not found') return res.status(404).json({ error: 'Chama not found' });
    console.error('[admin-chama members]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Members — enrol
// ---------------------------------------------------------------
const enrolSchema = Joi.object({
  client_id: Joi.number().integer().positive().required(),
});

router.post('/:id/members', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const { error, value } = enrolSchema.validate(req.body);
    if (error) return res.status(400).json({ error: 'client_id is required' });

    const result = await chama.enrolMember({
      chamaId: id,
      clientId: value.client_id,
      enrolledBy: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.message === 'Client already belongs to a chama') return res.status(409).json({ error: err.message });
    if (err.message === 'Client not found') return res.status(404).json({ error: err.message });
    if (err.message === 'Chama not found') return res.status(404).json({ error: err.message });
    if (err.message === 'Client is not active') return res.status(422).json({ error: 'Client is not active — reactivate the client first' });
    if (err.message === 'Chama is not active') return res.status(422).json({ error: 'Chama is not active' });
    console.error('[admin-chama enrol]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Members — remove
// ---------------------------------------------------------------
router.delete('/:id/members/:clientId', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const clientId = Number(req.params.clientId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid chama id' });
    if (!Number.isInteger(clientId) || clientId <= 0) return res.status(400).json({ error: 'Invalid client id' });

    await chama.removeMember({ chamaId: id, clientId, removedBy: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'Client does not belong to this chama') return res.status(409).json({ error: err.message });
    if (err.message === 'Client not found') return res.status(404).json({ error: err.message });
    console.error('[admin-chama remove]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Contributions — list
// ---------------------------------------------------------------
router.get('/:id/contributions', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const period = req.query.period || chama.currentPeriod();

    const [rows] = await db.query(
      `SELECT cc.id, cc.client_id, cl.full_name AS client_name, cl.phone,
              cc.period, cc.amount_due, cc.amount_paid, cc.status,
              cc.last_payment_at, cc.created_at
         FROM chama_contributions cc
         JOIN clients cl ON cl.id = cc.client_id
        WHERE cc.chama_id = ? AND cc.period = ?
        ORDER BY cl.full_name ASC`,
      [id, period]
    );
    res.json({ period, contributions: rows });
  } catch (err) {
    console.error('[admin-chama contributions]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Contributions — record (cash only; STK is client-initiated)
// ---------------------------------------------------------------
const contribSchema = Joi.object({
  client_id: Joi.number().integer().positive().required(),
  amount: Joi.number().positive().max(10000000).required(),
  channel: Joi.string().valid('cash', 'mpesa', 'bank').default('cash'),
  mpesa_receipt: Joi.string().max(50).allow('', null),
  reference: Joi.string().max(100).allow('', null),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/:id/contributions', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const { error, value } = contribSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Invalid input',
        details: error.details.map(function (d) { return { field: d.path.join('.'), message: d.message }; }),
      });
    }

    const result = await chama.recordContribution({
      chamaId: id,
      clientId: value.client_id,
      amount: value.amount,
      channel: value.channel,
      mpesaReceipt: value.mpesa_receipt,
      reference: value.reference,
      notes: value.notes,
      recordedBy: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.message.indexOf('not a member') !== -1) return res.status(409).json({ error: err.message });
    if (err.message.indexOf('not found') !== -1) return res.status(404).json({ error: err.message });
    if (err.message.indexOf('not active') !== -1) return res.status(422).json({ error: err.message });
    console.error('[admin-chama contribution]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Transactions — list (chama savings ledger)
// ---------------------------------------------------------------
router.get('/:id/transactions', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

    const [acctRows] = await db.query(
      'SELECT id FROM chama_savings_accounts WHERE chama_id = ? LIMIT 1',
      [id]
    );
    if (!acctRows.length) return res.status(404).json({ error: 'Chama savings account not found' });

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const [rows] = await db.query(
      `SELECT t.id, t.client_id, cl.full_name AS client_name,
              t.type, t.amount, t.balance_after, t.channel,
              t.mpesa_receipt, t.reference, t.notes, t.status,
              t.created_at
         FROM chama_savings_transactions t
         LEFT JOIN clients cl ON cl.id = t.client_id
        WHERE t.chama_savings_account_id = ?
        ORDER BY t.id DESC
        LIMIT ?`,
      [acctRows[0].id, limit]
    );
    res.json({ transactions: rows });
  } catch (err) {
    console.error('[admin-chama transactions]', err.message);
    next(err);
  }
});

// ---------------------------------------------------------------
// Times-money payouts
// ---------------------------------------------------------------

router.get('/:id/payouts', async (req, res, next) => {
  try {
    const chamaId = Number(req.params.id);
    if (!Number.isInteger(chamaId) || chamaId <= 0) return res.status(400).json({ error: 'Invalid chama id' });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const payouts = await chama.listPayouts(chamaId, { limit });
    res.json({ payouts });
  } catch (err) {
    console.error('[admin-chama payouts list]', err.message);
    next(err);
  }
});

router.get('/:id/next-recipient', async (req, res, next) => {
  try {
    const chamaId = Number(req.params.id);
    if (!Number.isInteger(chamaId) || chamaId <= 0) return res.status(400).json({ error: 'Invalid chama id' });
    const conn = await db.getConnection();
    try {
      const clientId = await chama.getNextRecipient(conn, chamaId);
      if (!clientId) return res.json({ next_recipient_client_id: null });
      const [rows] = await conn.query(
        'SELECT id, full_name, phone FROM clients WHERE id = ? LIMIT 1',
        [clientId]
      );
      res.json({
        next_recipient_client_id: clientId,
        next_recipient: rows.length ? rows[0] : null,
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[admin-chama next-recipient]', err.message);
    next(err);
  }
});

const payoutSchema = Joi.object({
  recipient_client_id: Joi.number().integer().positive().required(),
  amount: Joi.number().positive().max(10000000).required(),
  channel: Joi.string().valid('cash', 'mpesa', 'bank').default('cash'),
  mpesa_receipt: Joi.string().max(50).allow('', null),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/:id/payouts', async (req, res, next) => {
  try {
    const chamaId = Number(req.params.id);
    if (!Number.isInteger(chamaId) || chamaId <= 0) return res.status(400).json({ error: 'Invalid chama id' });
    const { error, value } = payoutSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Invalid input',
        details: error.details.map(function (d) { return { field: d.path.join('.'), message: d.message }; }),
      });
    }
    const result = await chama.recordPayout({
      chamaId,
      recipientClientId: value.recipient_client_id,
      amount: value.amount,
      channel: value.channel,
      mpesaReceipt: value.mpesa_receipt,
      notes: value.notes,
      recordedBy: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.message.indexOf('not enabled') !== -1) return res.status(409).json({ error: err.message });
    if (err.message.indexOf('not a member') !== -1) return res.status(409).json({ error: err.message });
    if (err.message.indexOf('Insufficient') !== -1) return res.status(422).json({ error: err.message });
    if (err.message.indexOf('not found') !== -1) return res.status(404).json({ error: err.message });
    console.error('[admin-chama payout create]', err.message);
    next(err);
  }
});


// ---------------------------------------------------------------
// Invites — create, list, cancel
// ---------------------------------------------------------------

const inviteCreateSchema = Joi.object({
  client_id: Joi.number().integer().positive().optional(),
  email: Joi.string().email().max(255).optional(),
  expires_in_days: Joi.number().integer().min(1).max(60).default(7),
}).or('client_id', 'email').messages({
  'object.missing': 'Provide either client_id or email',
});

router.post('/:id/invites', async (req, res, next) => {
  try {
    const chamaId = Number(req.params.id);
    if (!Number.isInteger(chamaId) || chamaId <= 0) return res.status(400).json({ error: 'Invalid chama id' });

    const { error, value } = inviteCreateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Invalid input',
        details: error.details.map(function (d) { return { field: d.path.join('.'), message: d.message }; }),
      });
    }

    const [chamaRows] = await db.query('SELECT id, name, code FROM chamas WHERE id = ? LIMIT 1', [chamaId]);
    if (!chamaRows.length) return res.status(404).json({ error: 'Chama not found' });
    const chamaRow = chamaRows[0];
    if (chamaRow.status === 'inactive') return res.status(409).json({ error: 'Chama is inactive' });

    let clientId = null;
    let targetEmail = null;
    let targetName = null;

    if (value.client_id) {
      const [clientRows] = await db.query(
        'SELECT c.id, c.full_name, c.status, c.chama_id, u.email FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ? LIMIT 1',
        [value.client_id]
      );
      if (!clientRows.length) return res.status(404).json({ error: 'Client not found' });
      const clientRow = clientRows[0];
      if (clientRow.status !== 'active') return res.status(422).json({ error: 'Client is not active' });
      if (clientRow.chama_id) return res.status(409).json({ error: 'Client already belongs to a chama' });
      clientId = clientRow.id;
      targetEmail = clientRow.email;
      targetName = clientRow.full_name;
    } else {
      // email-only invite
      const emailLower = value.email.toLowerCase().trim();
      const [existingClient] = await db.query(
        'SELECT c.id FROM clients c JOIN users u ON u.id = c.user_id WHERE LOWER(u.email) = ? LIMIT 1',
        [emailLower]
      );
      if (existingClient.length) {
        return res.status(409).json({ error: 'This email belongs to an existing client — use client_id to invite them' });
      }
      targetEmail = emailLower;
    }

    // Check for existing pending invite
    const [dupes] = await db.query(
      `SELECT id FROM chama_invites
       WHERE chama_id = ? AND status = 'pending'
         AND ((client_id = ? AND client_id IS NOT NULL)
              OR (email = ? AND email IS NOT NULL))
       LIMIT 1`,
      [chamaId, clientId, targetEmail]
    );
    if (dupes.length) return res.status(409).json({ error: 'A pending invite already exists for this recipient' });

    // Generate token
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresInDays = value.expires_in_days || 7;

    const [insertResult] = await db.query(
      `INSERT INTO chama_invites (chama_id, client_id, email, token, status, expires_at, invited_by)
       VALUES (?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL ? DAY), ?)`,
      [chamaId, clientId, targetEmail, token, expiresInDays, req.user.id]
    );
    const inviteId = insertResult.insertId;

    // Build URLs
    const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
    const acceptUrl = `${baseUrl}/client/chama/invite?token=${token}`;
    const declineUrl = `${baseUrl}/client/chama/invite?token=${token}&action=decline`;

    // Send email (best-effort)
    let emailSent = false;
    let emailError = null;
    try {
      const [inviterRows] = await db.query('SELECT email FROM users WHERE id = ? LIMIT 1', [req.user.id]);
      const inviterName = inviterRows.length ? inviterRows[0].email : 'Your chama admin';
      // Email — always send (has the accept link)
      await email.sendChamaInvite({
        to: targetEmail,
        fullName: targetName || 'there',
        chamaName: chamaRow.name,
        chamaCode: chamaRow.code,
        inviterName,
        acceptUrl,
        declineUrl,
        expiresInDays,
      });
      emailSent = true;
      // SMS/WhatsApp nudge if we have a client record (existing-client invites)
      if (clientId) {
        notify.alert({
          template: 'chama_invite',
          clientId: clientId,
          data: {
            chamaName: chamaRow.name,
            chamaCode: chamaRow.code,
            inviterName: inviterName,
            token: token,
          },
        }).catch(function (e) { console.error('[notify chama invite]', e.message); });
      }
    } catch (mailErr) {
      console.error('[admin-chama invite email]', mailErr.message);
      emailError = mailErr.message;
    }

    // Audit
    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'chama.invite_created',
      entityType: 'chama_invite',
      entityId: inviteId,
      newValues: { chama_id: chamaId, client_id: clientId, email: targetEmail, expires_in_days: expiresInDays, email_sent: emailSent },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(function () {});

    res.status(201).json({
      ok: true,
      invite_id: inviteId,
      token,
      expires_in_days: expiresInDays,
      email_sent: emailSent,
      email_error: emailError,
      accept_url: acceptUrl,
    });
  } catch (err) {
    console.error('[admin-chama invite create]', err.message);
    next(err);
  }
});

router.get('/:id/invites', async (req, res, next) => {
  try {
    const chamaId = Number(req.params.id);
    if (!Number.isInteger(chamaId) || chamaId <= 0) return res.status(400).json({ error: 'Invalid chama id' });

    const status = (req.query.status || 'pending').trim();
    const allowed = ['pending', 'accepted', 'declined', 'expired', 'all'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const where = status === 'all' ? 'WHERE ci.chama_id = ?' : 'WHERE ci.chama_id = ? AND ci.status = ?';
    const params = status === 'all' ? [chamaId] : [chamaId, status];

    const [rows] = await db.query(
      `SELECT ci.id, ci.chama_id, ci.client_id, ci.email, ci.status, ci.expires_at,
              ci.created_at, ci.responded_at,
              c.full_name AS client_name,
              u.email AS invited_by_email
         FROM chama_invites ci
         LEFT JOIN clients c ON c.id = ci.client_id
         LEFT JOIN users u ON u.id = ci.invited_by
         ${where}
        ORDER BY ci.created_at DESC
        LIMIT 100`,
      params
    );
    res.json({ invites: rows, status_filter: status });
  } catch (err) {
    console.error('[admin-chama invites list]', err.message);
    next(err);
  }
});

router.delete('/:id/invites/:inviteId', async (req, res, next) => {
  try {
    const chamaId = Number(req.params.id);
    const inviteId = Number(req.params.inviteId);
    if (!Number.isInteger(chamaId) || chamaId <= 0) return res.status(400).json({ error: 'Invalid chama id' });
    if (!Number.isInteger(inviteId) || inviteId <= 0) return res.status(400).json({ error: 'Invalid invite id' });

    const [rows] = await db.query(
      'SELECT id, status FROM chama_invites WHERE id = ? AND chama_id = ? LIMIT 1',
      [inviteId, chamaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invite not found' });
    if (rows[0].status !== 'pending') return res.status(409).json({ error: 'Only pending invites can be cancelled' });

    await db.query(
      "UPDATE chama_invites SET status = 'expired', responded_at = NOW() WHERE id = ?",
      [inviteId]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'chama.invite_cancelled',
      entityType: 'chama_invite',
      entityId: inviteId,
      newValues: { chama_id: chamaId },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(function () {});

    res.json({ ok: true });
  } catch (err) {
    console.error('[admin-chama invite cancel]', err.message);
    next(err);
  }
});

module.exports = router;
