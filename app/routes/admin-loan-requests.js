/*
 * Zaria — Admin loan-request review endpoints
 */

const express = require('express');
const Joi = require('joi');
const db = require('../db');
const loans = require('../services/loans');
const audit = require('../services/audit');
const email = require('../services/email');
const notify = require('../services/notify');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ---------------------------------------------------------------
// GET list
// ---------------------------------------------------------------

router.get('/', async (req, res) => {
  const status = req.query.status || 'pending';
  const allowed = ['pending', 'approved', 'rejected', 'cancelled', 'all'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const where = status === 'all' ? '' : 'WHERE r.status = ?';
  const params = status === 'all' ? [] : [status];

  const [rows] = await db.query(
    `SELECT r.id, r.requested_amount, r.requested_term_months, r.purpose, r.status,
            r.rejection_reason, r.reviewed_by, r.reviewed_at, r.created_loan_id,
            r.created_at,
            c.id AS client_id, c.full_name AS client_name, c.phone AS client_phone,
            c.national_id, c.status AS client_status,
            p.name AS product_name, p.interest_rate AS product_rate,
            (SELECT COUNT(*) FROM loans l
              WHERE l.client_id = c.id AND l.status IN ('active','overdue')) AS client_active_loans,
            (SELECT COUNT(*) FROM loans l
              WHERE l.client_id = c.id AND l.status = 'repaid') AS client_repaid_count
       FROM loan_requests r
       JOIN clients c ON c.id = r.client_id
       LEFT JOIN loan_products p ON p.id = r.product_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT 200`,
    params
  );

  res.json({ requests: rows });
});

// ---------------------------------------------------------------
// GET single
// ---------------------------------------------------------------

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await db.query(
    `SELECT r.*, c.full_name AS client_name, c.phone AS client_phone,
            c.national_id, p.name AS product_name, p.interest_rate AS product_rate
       FROM loan_requests r
       JOIN clients c ON c.id = r.client_id
       LEFT JOIN loan_products p ON p.id = r.product_id
      WHERE r.id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  // Client's past loans
  const [pastLoans] = await db.query(
    `SELECT id, principal, total_repayable, amount_repaid, status, created_at
       FROM loans
      WHERE client_id = ?
      ORDER BY id DESC
      LIMIT 10`,
    [rows[0].client_id]
  );

  res.json({ request: rows[0], past_loans: pastLoans });
});

// ---------------------------------------------------------------
// Approve: creates the loan via loans.createLoan, links the request
// ---------------------------------------------------------------

const approveSchema = Joi.object({
  // Optional overrides
  amount: Joi.number().positive().max(10000000).optional(),
  interest_rate: Joi.number().min(0).max(0.99).optional(),
  term_months: Joi.number().integer().min(1).max(24).optional(),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/:id/approve', async (req, res) => {
  const requestId = Number(req.params.id);
  const { error, value } = approveSchema.validate(req.body || {});
  if (error) return res.status(400).json({ error: 'Invalid input' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM loan_requests WHERE id = ? AND status = 'pending' FOR UPDATE`,
      [requestId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Not pending or already processed' });
    }
    const request = rows[0];

    // Product info for defaults
    const [prods] = await conn.query(
      'SELECT id, interest_rate, term_months FROM loan_products WHERE id = ?',
      [request.product_id]
    );
    if (!prods.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'Product no longer exists' });
    }
    const product = prods[0];

    const principal = value.amount != null
      ? value.amount
      : Number(request.requested_amount);
    const interestRate = value.interest_rate != null
      ? value.interest_rate
      : Number(product.interest_rate);
    const termMonths = value.term_months != null
      ? value.term_months
      : Number(request.requested_term_months);

    // Create the loan inside our transaction (externalConn prevents
    // createLoan from opening/committing its own).
    const created = await loans.createLoan({
      clientId: request.client_id,
      productId: request.product_id,
      principal,
      interestRate,
      termMonths,
      purpose: request.purpose,
      createdBy: req.user.id,
      externalConn: conn,
    });

    // Link the request to the loan — same transaction
    await conn.query(
      `UPDATE loan_requests
          SET status = 'approved',
              reviewed_by = ?,
              reviewed_at = NOW(),
              created_loan_id = ?
        WHERE id = ?`,
      [req.user.id, created.loanId, requestId]
    );

    // Single commit for the whole business operation
    await conn.commit();

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'loan_request.approved',
      entityType: 'loan_request',
      entityId: requestId,
      newValues: {
        loan_id: created.loanId,
        requested_amount: Number(request.requested_amount),
        requested_term_months: Number(request.requested_term_months),
        approved_amount: principal,
        approved_interest_rate: interestRate,
        approved_term_months: termMonths,
        terms_changed:
          principal !== Number(request.requested_amount) ||
          termMonths !== Number(request.requested_term_months),
      },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

        // Notify client (non-blocking)
    try {
      const [crows] = await db.query(
        "SELECT u.email AS user_email, c.full_name, c.id AS client_id FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ?",
        [request.client_id]
      );
      if (crows.length && crows[0].user_email) {
        notify.alert({
          template: 'loan_request_approved',
          clientId: crows[0].client_id,
          data: {
            clientName: crows[0].full_name,
            amount: principal,
            termMonths: termMonths,
            loanId: created.loanId,
            interestRate: interestRate,
          },
        }).catch(function (e) { console.error("[notify request-approved]", e.message); });
      }
    } catch (e) {
      console.error("[notify approve]", e.message);
    }
    res.json({ ok: true, loan_id: created.loanId, request_id: requestId });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[loan-request approve]', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------
// Reject
// ---------------------------------------------------------------

const rejectSchema = Joi.object({
  reason: Joi.string().min(3).max(500).required(),
  send_reason: Joi.boolean().default(true),
});

router.post('/:id/reject', async (req, res) => {
  const requestId = Number(req.params.id);
  const { error, value } = rejectSchema.validate(req.body);
  if (error) return res.status(400).json({ error: 'Invalid input' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM loan_requests WHERE id = ? AND status = 'pending' FOR UPDATE`,
      [requestId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Not pending or already processed' });
    }
    const request = rows[0];

    await conn.query(
      `UPDATE loan_requests
          SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW()
        WHERE id = ?`,
      [value.reason, req.user.id, requestId]
    );

    await conn.commit();

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'loan_request.rejected',
      entityType: 'loan_request',
      entityId: requestId,
      newValues: { reason: value.reason },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Notify client (non-blocking)
    try {
      const [crows] = await db.query(
        "SELECT u.email AS user_email, c.full_name, c.id AS client_id FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ?",
        [request.client_id]
      );
      if (crows.length && crows[0].user_email) {
        notify.alert({
          template: 'loan_request_rejected',
          clientId: crows[0].client_id,
          data: {
            clientName: crows[0].full_name,
            reason: value.reason,
            amount: Number(request.requested_amount),
          },
        }).catch(function (e) { console.error("[notify request-rejected]", e.message); });
      }
    } catch (e) {
      console.error("[notify reject]", e.message);
    }
    res.json({ ok: true });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[loan-request reject]', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
