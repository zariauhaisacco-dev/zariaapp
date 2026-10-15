const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const loans = require('../services/loans');
const audit = require('../services/audit');
const savings = require('../services/savings');
const email = require('../services/email');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------
// GET /api/me — any authenticated user (admin or client)
// ---------------------------------------------------------------
router.get('/', authenticate, async (req, res) => {
  const user = { id: req.user.id, email: req.user.email, role: req.user.role };

  if (req.user.role === 'client') {
    try {
      const [rows] = await db.query(
        'SELECT id AS client_id, full_name, phone FROM clients WHERE user_id = ? LIMIT 1',
        [req.user.id]
      );
      if (rows.length) {
        user.client_id = rows[0].client_id;
        user.full_name = rows[0].full_name;
        user.phone = rows[0].phone;
      }
    } catch (e) {
      console.error('[me.js] client lookup failed:', e.message);
    }
  }

  res.json({ user });
});

// ---------------------------------------------------------------
// Client-only middleware applied per-route
// ---------------------------------------------------------------
async function clientOnly(req, res, next) {
  if (req.user.role !== 'client') {
    return res.status(403).json({ error: 'Client access only' });
  }
  const [rows] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Client profile not found' });
  req.clientId = rows[0].id;
  next();
}

const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'u:' + (req.user ? req.user.id : req.ip),
  message: { error: 'Too many loan requests. Try again in an hour.' },
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'pw:' + (req.user ? req.user.id : req.ip),
  message: { error: 'Too many password change attempts. Try again in 15 minutes.' },
});

// ---------------------------------------------------------------
// GET /summary
// ---------------------------------------------------------------
router.get('/summary', authenticate, clientOnly, async (req, res) => {
  try {
    const [clients] = await db.query(
      'SELECT id, full_name, phone, status FROM clients WHERE id = ?',
      [req.clientId]
    );
    if (!clients.length) return res.status(404).json({ error: 'Client not found' });
    const client = clients[0];

    const [activeLoans] = await db.query(
      `SELECT id, principal, total_repayable, amount_repaid, status, term_months,
              interest_rate, disbursed_at
         FROM loans
        WHERE client_id = ? AND status IN ('active','overdue')
        ORDER BY id DESC LIMIT 1`,
      [req.clientId]
    );

    let activeLoan = null;
    let nextPayment = null;
    if (activeLoans.length) {
      const state = await loans.computeLoanState(activeLoans[0].id);
      activeLoan = state.loan;
      nextPayment = state.summary.nextPayment;
    }

    const [pendingRequests] = await db.query(
      `SELECT id, requested_amount, requested_term_months, purpose, created_at
         FROM loan_requests
        WHERE client_id = ? AND status = 'pending'
        ORDER BY id DESC LIMIT 1`,
      [req.clientId]
    );

    const [recentTxns] = await db.query(
      `SELECT t.id, t.type, t.amount, t.mpesa_receipt, t.status, t.created_at,
              l.id AS loan_id
         FROM transactions t
         JOIN loans l ON l.id = t.loan_id
        WHERE t.client_id = ?
        ORDER BY t.id DESC
        LIMIT 5`,
      [req.clientId]
    );

    // --- Member funds: savings, shares, dividends ---
    const [savingsRows] = await db.query(
      `SELECT id, account_number, balance, total_deposited, total_withdrawn, status
         FROM savings_accounts
        WHERE client_id = ? AND status = 'active'
        LIMIT 1`,
      [req.clientId]
    );
    const savings = savingsRows[0] || null;

    const [sharesRows] = await db.query(
      `SELECT shares_held, total_purchased, total_redeemed, total_invested
         FROM share_holdings
        WHERE client_id = ?
        LIMIT 1`,
      [req.clientId]
    );
    const shares = sharesRows[0] || null;

    // Share par value is fixed at KES 100
    const shareParValue = 100;

    const [dividendRows] = await db.query(
      `SELECT
         COALESCE(SUM(gross_amount), 0) AS gross,
         COALESCE(SUM(withholding_tax), 0) AS tax,
         COALESCE(SUM(net_amount), 0) AS net,
         COUNT(*) AS count
         FROM dividend_payouts
        WHERE client_id = ? AND status = 'credited'`,
      [req.clientId]
    );

    res.json({
      client,
      active_loan: activeLoan,
      next_payment: nextPayment,
      pending_request: pendingRequests[0] || null,
      recent_transactions: recentTxns,
      savings: savings ? {
        account_number: savings.account_number,
        balance: Number(savings.balance),
        total_deposited: Number(savings.total_deposited),
        total_withdrawn: Number(savings.total_withdrawn),
      } : null,
      shares: {
        shares_held: shares ? Number(shares.shares_held) : 0,
        shares_value: shares ? Number(shares.shares_held) * shareParValue : 0,
        share_par_value: shareParValue,
        total_invested: shares ? Number(shares.total_invested) : 0,
      },
      dividends: {
        gross: Number(dividendRows[0].gross),
        tax: Number(dividendRows[0].tax),
        net: Number(dividendRows[0].net),
        count: Number(dividendRows[0].count),
      },
    });
  } catch (err) {
    console.error('[me/summary]', err.message);
    res.status(500).json({ error: 'Could not load summary' });
  }
});

// ---------------------------------------------------------------
// GET /loans
// ---------------------------------------------------------------
router.get('/loans', authenticate, clientOnly, async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, principal, total_repayable, amount_repaid, status, term_months,
            interest_rate, purpose, disbursed_at, created_at
       FROM loans
      WHERE client_id = ?
      ORDER BY id DESC`,
    [req.clientId]
  );

  const enriched = rows.map(r => {
    const total = Number(r.total_repayable);
    const repaid = Number(r.amount_repaid);
    return {
      ...r,
      principal: Number(r.principal),
      total_repayable: total,
      amount_repaid: repaid,
      outstanding: Math.round((total - repaid) * 100) / 100,
      progressPct: total > 0 ? Math.round((repaid / total) * 100) : 0,
    };
  });

  res.json({ loans: enriched });
});

// ---------------------------------------------------------------
// GET /loans/:id
// ---------------------------------------------------------------
router.get('/loans/:id', authenticate, clientOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const [owner] = await db.query(
    'SELECT id FROM loans WHERE id = ? AND client_id = ? LIMIT 1',
    [id, req.clientId]
  );
  if (!owner.length) return res.status(404).json({ error: 'Not found' });

  const state = await loans.computeLoanState(id);
  const transactions = await loans.getTransactions(id);

  res.json({
    loan: state.loan,
    summary: state.summary,
    schedule: state.schedule,
    transactions,
  });
});

// ---------------------------------------------------------------
// GET /loan-products
// ---------------------------------------------------------------
router.get('/loan-products', authenticate, clientOnly, async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, name, min_amount, max_amount, interest_rate, term_months
       FROM loan_products
      WHERE active = 1
      ORDER BY min_amount ASC`
  );
  res.json({ products: rows });
});

// ---------------------------------------------------------------
// GET /loan-requests
// ---------------------------------------------------------------
router.get('/loan-requests', authenticate, clientOnly, async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, requested_amount, requested_term_months, purpose, status,
            rejection_reason, reviewed_at, created_loan_id, created_at
       FROM loan_requests
      WHERE client_id = ?
      ORDER BY id DESC
      LIMIT 50`,
    [req.clientId]
  );
  res.json({ requests: rows });
});

// ---------------------------------------------------------------
// POST /loan-requests
// ---------------------------------------------------------------
const requestSchema = Joi.object({
  product_id: Joi.number().integer().positive().required(),
  requested_amount: Joi.number().positive().max(10000000).required(),
  purpose: Joi.string().max(500).allow('', null),
});

router.post('/loan-requests', authenticate, clientOnly, requestLimiter, async (req, res) => {
  const { error, value } = requestSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      error: 'Invalid input',
      details: error.details.map(d => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [clients] = await conn.query(
      'SELECT id, status FROM clients WHERE id = ? FOR UPDATE',
      [req.clientId]
    );
    if (!clients.length) throw new Error('Client not found');
    if (clients[0].status !== 'active') throw new Error('Your account is not active');

    const [activeLoans] = await conn.query(
      `SELECT id FROM loans
        WHERE client_id = ? AND status IN ('pending','approved','active','overdue')
        LIMIT 1`,
      [req.clientId]
    );
    if (activeLoans.length) {
      throw new Error('You already have an active loan. Repay it fully before requesting another.');
    }

    const [pendingReq] = await conn.query(
      `SELECT id FROM loan_requests
        WHERE client_id = ? AND status = 'pending'
        LIMIT 1`,
      [req.clientId]
    );
    if (pendingReq.length) {
      throw new Error('You already have a pending request. Please wait for review.');
    }

    const [prodRows] = await conn.query(
      'SELECT id, name, min_amount, max_amount, interest_rate, term_months, active FROM loan_products WHERE id = ?',
      [value.product_id]
    );
    if (!prodRows.length) throw new Error('Product not found');
    const product = prodRows[0];
    if (!product.active) throw new Error('Product is not available');

    const amt = Number(value.requested_amount);
    if (amt < Number(product.min_amount) || amt > Number(product.max_amount)) {
      throw new Error(
        'Amount must be between ' +
        Number(product.min_amount).toLocaleString() + ' and ' +
        Number(product.max_amount).toLocaleString()
      );
    }

    // Savings-based loan eligibility check
    const eligibility = await savings.checkLoanEligibility(req.clientId, amt);
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason);
    }

    const [ins] = await conn.query(
      `INSERT INTO loan_requests
        (client_id, product_id, requested_amount, requested_term_months, purpose, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [req.clientId, product.id, amt, product.term_months, value.purpose || null]
    );

    await conn.commit();

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'loan_request.submitted',
      entityType: 'loan_request',
      entityId: ins.insertId,
      newValues: { product_id: product.id, amount: amt, term_months: product.term_months },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });


    // Send notifications (non-blocking — never fail the request on email errors)
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_USER;
    if (adminEmail) {
      email.sendAdminNewLoanRequest(adminEmail, {
        client_name: req.user.email,
        client_phone: '',
        amount: amt,
        term_months: product.term_months,
        product_name: product.name,
        purpose: value.purpose || null,
        request_id: ins.insertId,
      }).catch(e => console.error('[email admin-new-request]', e.message));
    }
    email.sendLoanRequestReceived(req.user.email, {
      client_name: req.user.email,
      amount: amt,
      term_months: product.term_months,
    }).catch(e => console.error('[email request-received]', e.message));

    res.json({ ok: true, request_id: ins.insertId });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[me/loan-request]', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------
// POST /loan-requests/:id/cancel
// ---------------------------------------------------------------
router.post('/loan-requests/:id/cancel', authenticate, clientOnly, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [result] = await db.query(
      `UPDATE loan_requests
          SET status = 'cancelled'
        WHERE id = ? AND client_id = ? AND status = 'pending'`,
      [id, req.clientId]
    );
    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Cannot cancel this request' });
    }
    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'loan_request.cancelled',
      entityType: 'loan_request',
      entityId: id,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[me/loan-request/cancel]', err.message);
    res.status(500).json({ error: 'Could not cancel' });
  }
});

// ---------------------------------------------------------------
// POST /password — change own password
// ---------------------------------------------------------------
const passwordSchema = Joi.object({
  current_password: Joi.string().min(1).max(200).required(),
  new_password: Joi.string().min(8).max(200).required()
    .messages({ 'string.min': 'New password must be at least 8 characters' }),
  confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
    .messages({ 'any.only': 'Passwords do not match' }),
});

router.post('/password', authenticate, passwordLimiter, async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  const { error, value } = passwordSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const details = error.details.map(d => ({ field: d.path.join('.'), message: d.message }));
    return res.status(400).json({ error: 'Please check the form', details });
  }

  try {
    const [rows] = await db.query(
      'SELECT id, email, password_hash, role FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];

    const ok = await bcrypt.compare(value.current_password, user.password_hash);
    if (!ok) {
      await audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'password.change_failed',
        entityType: 'user',
        entityId: user.id,
        newValues: { reason: 'bad_current_password' },
        ip, userAgent: ua,
      });
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    if (value.new_password === value.current_password) {
      return res.status(400).json({ error: 'New password must differ from current password' });
    }

    const newHash = await bcrypt.hash(value.new_password, 12);
    await db.query(
      'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
      [newHash, user.id]
    );

    await audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'password.changed',
      entityType: 'user',
      entityId: user.id,
      ip, userAgent: ua,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[me/password]', err.message);
    res.status(500).json({ error: 'Could not change password' });
  }
});

// ---------------------------------------------------------------
// GET /transactions — client's full transaction history across all loans
// ---------------------------------------------------------------
router.get('/transactions', authenticate, clientOnly, async (req, res) => {
  const [rows] = await db.query(
    `SELECT t.id, t.type, t.amount, t.mpesa_receipt, t.reference,
            t.status, t.created_at,
            l.id AS loan_id, l.principal
       FROM transactions t
       JOIN loans l ON l.id = t.loan_id
      WHERE t.client_id = ?
      ORDER BY t.id DESC
      LIMIT 500`,
    [req.clientId]
  );
  res.json({ transactions: rows });
});

module.exports = router;
