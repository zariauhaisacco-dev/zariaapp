const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const loans = require('../services/loans');
const audit = require('../services/audit');
const savings = require('../services/savings');
const chama = require('../services/chama');
const daraja = require('../services/daraja');
const notify = require('../services/notify');
const email = require('../services/email');
const uploads = require('../services/uploads');
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

// Chama contributions — higher limit, members may contribute multiple times
const chamaContributeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'chama-u:' + (req.user ? req.user.id : req.ip),
  message: { error: 'Too many contribution attempts. Try again in an hour.' },
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


    // --- Chama data (if in a chama) ---
    let chamaData = null;
    const [cl] = await db.query('SELECT chama_id FROM clients WHERE id = ? LIMIT 1', [req.clientId]);
    if (cl.length && cl[0].chama_id) {
      const summary = await chama.getChamaSummary(cl[0].chama_id);
      const myContribution = summary.members.find(function (m) {
        return Number(m.client_id) === Number(req.clientId);
      }) || null;

      let tm = null;
      if (summary.chama.times_money_enabled) {
        const conn = await db.getConnection();
        try {
          const nextRecipientId = await chama.getNextRecipient(conn, summary.chama.id);
          const payouts = await chama.listPayouts(summary.chama.id, { limit: 20 });
          const myPayouts = payouts.filter(function (p) { return Number(p.client_id) === Number(req.clientId); });
          let nextRecipient = null;
          if (nextRecipientId) {
            const [nr] = await conn.query('SELECT id, full_name FROM clients WHERE id = ? LIMIT 1', [nextRecipientId]);
            nextRecipient = nr.length ? nr[0] : null;
          }
          const memberIds = summary.members.map(function (m) { return Number(m.client_id); });
          const myIndex = memberIds.indexOf(Number(req.clientId));
          tm = {
            enabled: true,
            order: summary.chama.times_money_order || 'rotation',
            my_position: myIndex >= 0 ? myIndex + 1 : null,
            total_members: memberIds.length,
            i_received: myPayouts.length > 0,
            my_total_received: myPayouts.reduce(function (s, p) { return s + Number(p.amount); }, 0),
            next_recipient: nextRecipient,
          };
        } finally { conn.release(); }
      }

      chamaData = {
        id: summary.chama.id,
        name: summary.chama.name,
        code: summary.chama.code,
        account_number: summary.savingsAccount ? summary.savingsAccount.account_number : null,
        group_balance: summary.stats.balance,
        member_count: summary.stats.memberCount,
        my_contribution: myContribution ? {
          period: myContribution.period,
          amount_due: Number(myContribution.amount_due),
          amount_paid: Number(myContribution.amount_paid),
          status: myContribution.contribution_status,
          last_payment_at: myContribution.last_payment_at,
        } : null,
        times_money: tm,
      };
    }

    // --- Unified activity feed ---
    const activityItems = [];

    const [loanTxns] = await db.query(
      `SELECT t.id, t.type, t.amount, t.mpesa_receipt, t.created_at
         FROM transactions t
         JOIN loans l ON l.id = t.loan_id
        WHERE t.client_id = ?
        ORDER BY t.id DESC LIMIT 10`,
      [req.clientId]
    );
    loanTxns.forEach(function (t) {
      activityItems.push({
        type: 'loan_' + t.type,
        label: t.type === 'repayment' ? 'Loan repayment' : t.type === 'disbursement' ? 'Loan disbursed' : 'Loan adjustment',
        amount: Number(t.amount),
        sign: t.type === 'repayment' ? '+' : '-',
        ref: t.mpesa_receipt,
        date: t.created_at,
        source: 'loan',
      });
    });

    if (savings) {
      const [savTxns] = await db.query(
        `SELECT id, type, amount, mpesa_receipt, created_at
           FROM savings_transactions
          WHERE savings_account_id = ?
          ORDER BY id DESC LIMIT 10`,
        [savings.id]
      );
      savTxns.forEach(function (t) {
        activityItems.push({
          type: 'savings_' + t.type,
          label: t.type === 'deposit' ? 'Savings deposit' : t.type === 'withdrawal' ? 'Savings withdrawal' : 'Savings interest',
          amount: Number(t.amount),
          sign: t.type === 'withdrawal' ? '-' : '+',
          ref: t.mpesa_receipt,
          date: t.created_at,
          source: 'savings',
        });
      });
    }

    if (chamaData) {
      const [chamaTxns] = await db.query(
        `SELECT t.id, t.type, t.amount, t.mpesa_receipt, t.created_at
           FROM chama_savings_transactions t
          WHERE t.client_id = ?
          ORDER BY t.id DESC LIMIT 10`,
        [req.clientId]
      );
      chamaTxns.forEach(function (t) {
        activityItems.push({
          type: 'chama_' + t.type,
          label: t.type === 'contribution' ? 'Chama contribution' : t.type === 'payout' ? 'Chama payout' : 'Chama ' + t.type,
          amount: Number(t.amount),
          sign: t.type === 'payout' ? '+' : '-',
          ref: t.mpesa_receipt,
          date: t.created_at,
          source: 'chama',
        });
      });
    }

    const [divPayouts] = await db.query(
      `SELECT id, net_amount, created_at
         FROM dividend_payouts
        WHERE client_id = ? AND status = 'credited'
        ORDER BY id DESC LIMIT 10`,
      [req.clientId]
    );
    divPayouts.forEach(function (d) {
      activityItems.push({
        type: 'dividend',
        label: 'Dividend payout',
        amount: Number(d.net_amount),
        sign: '+',
        ref: null,
        date: d.created_at,
        source: 'dividend',
      });
    });

    activityItems.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    const unifiedActivity = activityItems.slice(0, 15);

    const totalAssets = (savings ? Number(savings.balance) : 0)
      + (shares ? Number(shares.shares_held) * shareParValue : 0)
      + Number(dividendRows[0].net);
    const totalLiabilities = activeLoan ? (Number(activeLoan.total_repayable) - Number(activeLoan.amount_repaid)) : 0;

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
      chama: chamaData,
      activity: unifiedActivity,
      totals: {
        total_assets: totalAssets,
        total_liabilities: totalLiabilities,
        net_worth: totalAssets - totalLiabilities,
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

// ---------------------------------------------------------------
// Registration fee — check status + initiate STK
// ---------------------------------------------------------------
router.get('/registration-fee', authenticate, clientOnly, async (req, res) => {
  try {
    const [feeEnabledRow] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'registration_fee_enabled'");
    const [feeAmountRow] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'registration_fee'");
    const enabled = feeEnabledRow.length && feeEnabledRow[0].setting_value === '1';
    const feeAmount = feeAmountRow.length ? Number(feeAmountRow[0].setting_value) : 0;

    const [clientRows] = await db.query(
      'SELECT registration_fee_paid, registration_fee_amount, registration_fee_paid_at FROM clients WHERE id = ?',
      [req.clientId]
    );
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found' });
    const cl = clientRows[0];

    let feeRecord = null;
    if (cl.registration_fee_paid) {
      const [feeRows] = await db.query(
        'SELECT id, amount, channel, mpesa_receipt, status, created_at FROM registration_fees WHERE client_id = ? ORDER BY id DESC LIMIT 1',
        [req.clientId]
      );
      feeRecord = feeRows[0] || null;
    }

    res.json({
      enabled,
      amount: enabled ? (Number(cl.registration_fee_amount) || feeAmount) : 0,
      paid: !!cl.registration_fee_paid,
      paid_at: cl.registration_fee_paid_at,
      fee_record: feeRecord,
    });
  } catch (err) {
    console.error('[me/registration-fee]', err.message);
    res.status(500).json({ error: 'Could not load fee status' });
  }
});

router.post('/pay-registration-fee', authenticate, clientOnly, chamaContributeLimiter, async (req, res) => {
  try {
    const [feeEnabledRow] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'registration_fee_enabled'");
    if (!feeEnabledRow.length || feeEnabledRow[0].setting_value !== '1') {
      return res.status(409).json({ error: 'Registration fee is not enabled' });
    }

    const [clientRows] = await db.query(
      'SELECT id, phone, registration_fee_paid, registration_fee_amount FROM clients WHERE id = ?',
      [req.clientId]
    );
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found' });
    const client = clientRows[0];

    if (client.registration_fee_paid) return res.status(409).json({ error: 'Fee already paid' });

    const feeAmount = Number(client.registration_fee_amount);
    if (!(feeAmount > 0)) return res.status(409).json({ error: 'No fee amount set for this client' });

    const phone = String(req.body.phone || client.phone).trim();
    if (!/^2547\d{8}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone number' });

    const stkResult = await daraja.stkPush({
      phone,
      amount: feeAmount,
      accountReference: 'REGFEE-' + client.id,
      description: 'Registration fee',
    });

    await db.query(
      `INSERT INTO daraja_requests (client_id, registration_fee_client_id, checkout_request_id, merchant_request_id, phone, amount, direction, status)
       VALUES (?, ?, ?, ?, ?, ?, 'stk_push', 'pending')`,
      [client.id, client.id, stkResult.checkoutRequestId, stkResult.merchantRequestId, phone, feeAmount]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'registration_fee.stk_initiated',
      entityType: 'client',
      entityId: client.id,
      newValues: { amount: feeAmount, checkout_request_id: stkResult.checkoutRequestId },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(function () {});

    res.json({
      ok: true,
      checkout_request_id: stkResult.checkoutRequestId,
      message: 'Check your phone to enter your M-Pesa PIN',
    });
  } catch (err) {
    console.error('[me/pay-registration-fee]', err.message);
    res.status(500).json({ error: err.message || 'Could not initiate payment' });
  }
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

    // SMS alert to admin on new loan request
    try {
      const [phoneRow] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'admin_alert_phone'");
      const [enabledRow] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'admin_sms_alerts_enabled'");
      const adminPhone = phoneRow.length ? phoneRow[0].setting_value : '';
      const adminSmsEnabled = !enabledRow.length || enabledRow[0].setting_value === '1';
      if (adminPhone && adminSmsEnabled) {
        ping.sendSms({
          to: adminPhone,
          message: 'ZARIA: New loan request — KES ' + amt.toLocaleString() + ' for ' + product.term_months + ' months. Review: zariauhai.com/admin/requests',
          template: 'admin_new_loan_request',
        }).catch(function (e) { console.error('[me admin loan-request sms]', e.message); });
      }
    } catch (e) { console.error('[me admin loan-request sms]', e.message); }

    notify.alert({
      template: 'loan_request_received',
      clientId: req.clientId,
      data: {
        clientName: req.user.email,
        amount: amt,
        termMonths: product.term_months,
      },
    }).catch(e => console.error('[notify request-received]', e.message));

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
// POST /photo — upload or replace own profile photo
// ---------------------------------------------------------------
const photoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'ph:' + (req.user ? req.user.id : req.ip),
  message: { error: 'Too many uploads. Try again in 15 minutes.' },
});

function handleMulterError(req, res, next) {
  uploads.uploadPhoto(req, res, function (err) {
    if (err) {
      console.error('[me/photo] multer:', err.message);
      var msg = 'Upload failed';
      if (/File too large/i.test(err.message)) msg = 'File is too large (max 2 MB)';
      else if (/Unsupported file type/i.test(err.message)) msg = 'Only JPG, PNG, or WebP allowed';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

router.post('/photo', authenticate, clientOnly, photoLimiter, handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const rawAbs = req.file.path;
    const rawName = req.file.filename;

    // Always store as .jpg for consistency, regardless of input format.
    // NOTE: we append a timestamp suffix because rawName might already end
    // in .jpg, and sharp refuses to read and write the same file.
    const finalName = rawName.replace(/\.[^.]+$/, '') + '-' + Date.now() + '.jpg';
    const finalAbs = uploads.absPath('uploads/' + finalName);
    const finalRel = 'uploads/' + finalName;

    // Resize + re-encode as JPEG
    await sharp(rawAbs)
      .resize(400, 400, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(finalAbs);

    // If the ext changed, remove the raw upload
    if (rawAbs !== finalAbs) {
      try { fs.unlinkSync(rawAbs); } catch (_) {}
    }

    // Delete the old photo file (if any) unless it's the same path
    const [rows] = await db.query(
      'SELECT profile_photo_url FROM clients WHERE id = ? LIMIT 1',
      [req.clientId]
    );
    if (rows.length && rows[0].profile_photo_url && rows[0].profile_photo_url !== finalRel) {
      uploads.deleteFile(rows[0].profile_photo_url);
    }

    await db.query(
      'UPDATE clients SET profile_photo_url = ? WHERE id = ?',
      [finalRel, req.clientId]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'profile_photo.uploaded',
      entityType: 'client',
      entityId: req.clientId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, url: '/api/me/photo?v=' + Date.now() });
  } catch (err) {
    console.error('[me/photo]', err.message);
    res.status(500).json({ error: 'Could not save photo' });
  }
});

// ---------------------------------------------------------------
// GET /photo — stream own profile photo
// ---------------------------------------------------------------
router.get('/photo', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT profile_photo_url FROM clients WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    if (!rows.length || !rows[0].profile_photo_url) {
      return res.status(404).end();
    }
    const rel = rows[0].profile_photo_url;
    uploads.streamFile(rel, res, uploads.contentTypeFor(rel));
  } catch (err) {
    console.error('[me/photo get]', err.message);
    res.status(500).json({ error: 'Could not load photo' });
  }
});

// ---------------------------------------------------------------
// GET /notifications — client notifications
// ---------------------------------------------------------------
router.get('/notifications', authenticate, clientOnly, async (req, res) => {
  try {
    const items = [];

    // Pending loan request
    const [reqs] = await db.query(
      `SELECT COUNT(*) AS n FROM loan_requests WHERE client_id = ? AND status = 'pending'`,
      [req.clientId]
    );
    if (reqs[0].n > 0) {
      items.push({
        type: 'pending_request',
        title: 'Your loan request is awaiting review',
        href: '/client/loans',
      });
    }

    // Overdue payments
    const [od] = await db.query(
      `SELECT COUNT(*) AS n, MIN(l.id) AS loan_id
         FROM loan_payments lp
         JOIN loans l ON l.id = lp.loan_id
        WHERE l.client_id = ? AND lp.status = 'overdue'`,
      [req.clientId]
    );
    if (od[0].n > 0) {
      items.push({
        type: 'overdue',
        title: od[0].n + ' overdue payment' + (od[0].n === 1 ? '' : 's'),
        href: od[0].loan_id ? '/client/loans/' + od[0].loan_id : '/client/loans',
      });
    }

    // Due within 7 days
    const [due] = await db.query(
      `SELECT lp.amount_due, lp.amount_paid, lp.due_date,
              DATEDIFF(lp.due_date, CURDATE()) AS days_left,
              l.id AS loan_id
         FROM loan_payments lp
         JOIN loans l ON l.id = lp.loan_id
        WHERE l.client_id = ?
          AND lp.status IN ('pending','partial')
          AND lp.due_date >= CURDATE()
          AND lp.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        ORDER BY lp.due_date ASC
        LIMIT 1`,
      [req.clientId]
    );
    if (due.length) {
      const remaining = Number(due[0].amount_due) - Number(due[0].amount_paid);
      const d = due[0].days_left;
      items.push({
        type: 'due_soon',
        title: 'KES ' + Math.round(remaining).toLocaleString() + ' due ' +
               (d === 0 ? 'today' : (d === 1 ? 'tomorrow' : 'in ' + d + ' days')),
        href: '/client/loans/' + due[0].loan_id,
      });
    }

    res.json({ count: items.length, items });
  } catch (err) {
    console.error('[me/notifications]', err.message);
    res.status(500).json({ error: 'Could not load notifications' });
  }
});

// ---------------------------------------------------------------
// POST /id-document — upload or replace own national ID
// ---------------------------------------------------------------
const idDocLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'idoc:' + (req.user ? req.user.id : req.ip),
  message: { error: 'Too many uploads. Try again in 15 minutes.' },
});

function handleIdDocMulterError(req, res, next) {
  uploads.uploadIdDocument(req, res, function (err) {
    if (err) {
      console.error('[me/id-document] multer:', err.message);
      var msg = 'Upload failed';
      if (/File too large/i.test(err.message)) msg = 'File is too large (max 5 MB)';
      else if (/Unsupported file type/i.test(err.message)) msg = 'Only JPG, PNG, or PDF allowed';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

router.post('/id-document', authenticate, clientOnly, idDocLimiter, handleIdDocMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const finalAbs = req.file.path;
    const finalRel = uploads.relFor(req.file.filename);

    // Delete old document (if any) unless it's the same path
    const [rows] = await db.query(
      'SELECT id_document_url FROM clients WHERE id = ? LIMIT 1',
      [req.clientId]
    );
    if (rows.length && rows[0].id_document_url && rows[0].id_document_url !== finalRel) {
      uploads.deleteFile(rows[0].id_document_url);
    }

    await db.query(
      'UPDATE clients SET id_document_url = ?, id_document_uploaded_at = NOW() WHERE id = ?',
      [finalRel, req.clientId]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'id_document.uploaded',
      entityType: 'client',
      entityId: req.clientId,
      newValues: { filename: req.file.filename, size: req.file.size },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, url: '/api/me/id-document?v=' + Date.now() });
  } catch (err) {
    console.error('[me/id-document]', err.message);
    res.status(500).json({ error: 'Could not save document' });
  }
});

// ---------------------------------------------------------------
// GET /id-document — stream own national ID
// ---------------------------------------------------------------
router.get('/id-document', authenticate, clientOnly, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id_document_url FROM clients WHERE id = ? LIMIT 1',
      [req.clientId]
    );
    if (!rows.length || !rows[0].id_document_url) {
      return res.status(404).end();
    }
    const rel = rows[0].id_document_url;
    uploads.streamFile(rel, res, uploads.contentTypeFor(rel));
  } catch (err) {
    console.error('[me/id-document get]', err.message);
    res.status(500).json({ error: 'Could not load document' });
  }
});

// ---------------------------------------------------------------
// GET /profile-info — non-sensitive profile info (has ID doc, photo, etc.)
// ---------------------------------------------------------------
router.get('/profile-info', authenticate, clientOnly, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id_document_url IS NOT NULL AS has_id_document,
              id_document_uploaded_at,
              profile_photo_url IS NOT NULL AS has_photo
         FROM clients WHERE id = ? LIMIT 1`,
      [req.clientId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    const r = rows[0];
    res.json({
      has_id_document: !!r.has_id_document,
      id_document_uploaded_at: r.id_document_uploaded_at,
      has_photo: !!r.has_photo,
    });
  } catch (err) {
    console.error('[me/profile-info]', err.message);
    res.status(500).json({ error: 'Could not load profile info' });
  }
});

// ---------------------------------------------------------------
// GET /statements — list of client's loans (for statements page)
// ---------------------------------------------------------------
router.get('/statements', authenticate, clientOnly, async (req, res) => {
  try {
    const [loans] = await db.query(
      `SELECT l.id, l.principal, l.total_repayable, l.amount_repaid,
              l.interest_rate, l.term_months, l.status,
              l.created_at, l.disbursed_at, l.closed_at,
              p.name AS product_name
         FROM loans l
         LEFT JOIN loan_products p ON p.id = l.product_id
        WHERE l.client_id = ?
        ORDER BY l.id DESC`,
      [req.clientId]
    );

    const out = loans.map(function (l) {
      const total = Number(l.total_repayable);
      const repaid = Number(l.amount_repaid);
      return {
        id: l.id,
        principal: Number(l.principal),
        total_repayable: total,
        amount_repaid: repaid,
        outstanding: Math.round((total - repaid) * 100) / 100,
        progress_pct: total > 0 ? Math.round((repaid / total) * 100) : 0,
        interest_rate: Number(l.interest_rate),
        term_months: l.term_months,
        status: l.status,
        product_name: l.product_name,
        created_at: l.created_at,
        disbursed_at: l.disbursed_at,
        closed_at: l.closed_at,
      };
    });

    res.json({ loans: out });
  } catch (err) {
    console.error('[me/statements]', err.message);
    res.status(500).json({ error: 'Could not load statements' });
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

// ---------------------------------------------------------------
// GET /chama — my chama info + this months contribution
// ---------------------------------------------------------------
router.get('/chama', authenticate, clientOnly, async (req, res) => {
  try {
    const [clientRows] = await db.query(
      'SELECT chama_id FROM clients WHERE id = ? LIMIT 1',
      [req.clientId]
    );
    if (!clientRows.length || !clientRows[0].chama_id) {
      return res.json({ chama: null });
    }
    const summary = await chama.getChamaSummary(clientRows[0].chama_id);
    const myContribution = summary.members.find(function (m) {
      return Number(m.client_id) === Number(req.clientId);
    }) || null;
    const myRecentTx = summary.recentTransactions.filter(function (t) {
      return Number(t.client_id) === Number(req.clientId);
    }).slice(0, 20);
    // Times-money data (if enabled)
    let timesMoney = null;
    if (summary.chama.times_money_enabled) {
      const conn = await db.getConnection();
      try {
        const nextRecipientId = await chama.getNextRecipient(conn, summary.chama.id);
        const payouts = await chama.listPayouts(summary.chama.id, { limit: 20 });
        const myPayouts = payouts.filter(function (p) { return Number(p.client_id) === Number(req.clientId); });

        let nextRecipient = null;
        if (nextRecipientId) {
          const [nr] = await conn.query('SELECT id, full_name FROM clients WHERE id = ? LIMIT 1', [nextRecipientId]);
          nextRecipient = nr.length ? nr[0] : null;
        }

        const memberIds = summary.members.map(function (m) { return Number(m.client_id); });
        const myIndex = memberIds.indexOf(Number(req.clientId));

        timesMoney = {
          enabled: true,
          order: summary.chama.times_money_order || 'rotation',
          my_position: myIndex >= 0 ? myIndex + 1 : null,
          total_members: memberIds.length,
          i_received: myPayouts.length > 0,
          my_payouts: myPayouts.slice(0, 5).map(function (p) { return { id: p.id, amount: Number(p.amount), created_at: p.created_at }; }),
          next_recipient: nextRecipient ? { id: nextRecipient.id, full_name: nextRecipient.full_name } : null,
          recent_payouts: payouts.slice(0, 10).map(function (p) {
            return { id: p.id, client_id: p.client_id, client_name: p.client_name, amount: Number(p.amount), channel: p.channel, created_at: p.created_at };
          }),
        };
      } finally {
        conn.release();
      }
    }


    res.json({
      chama: {
        id: summary.chama.id,
        name: summary.chama.name,
        code: summary.chama.code,
        status: summary.chama.status,
        monthly_contribution_min: Number(summary.chama.monthly_contribution_min),
        account_number: summary.savingsAccount ? summary.savingsAccount.account_number : null,
        balance: summary.stats.balance,
        member_count: summary.stats.memberCount,
      },
      my_contribution: myContribution ? {
        period: myContribution.period,
        amount_due: Number(myContribution.amount_due),
        amount_paid: Number(myContribution.amount_paid),
        status: myContribution.contribution_status,
        last_payment_at: myContribution.last_payment_at,
      } : null,
      my_recent_transactions: myRecentTx,
      times_money: timesMoney,
    });
  } catch (err) {
    console.error('[me/chama]', err.message);
    res.status(500).json({ error: 'Could not load chama' });
  }
});

// ---------------------------------------------------------------
// POST /chama/contribute — initiate STK push for contribution
// ---------------------------------------------------------------
const chamaContributeSchema = Joi.object({
  phone: Joi.string().pattern(/^2547\d{8}$/).optional(),
  amount: Joi.number().positive().max(1000000).required(),
});

router.post('/chama/contribute', authenticate, clientOnly, chamaContributeLimiter, async (req, res) => {
  try {
    // Registration fee guard
    const [feeCheck] = await db.query('SELECT registration_fee_paid FROM clients WHERE id = ?', [req.clientId]);
    if (feeCheck.length && !feeCheck[0].registration_fee_paid) {
      const [feeRow] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key='registration_fee'");
      return res.status(402).json({
        error: 'Registration fee required',
        code: 'registration_fee_required',
        amount: feeRow.length ? Number(feeRow[0].setting_value) : 0,
      });
    }
    const { error, value } = chamaContributeSchema.validate(req.body);
    if (error) return res.status(400).json({ error: 'Amount is required and must be positive' });

    const [clientRows] = await db.query(
      'SELECT id, phone, chama_id FROM clients WHERE id = ? LIMIT 1',
      [req.clientId]
    );
    if (!clientRows.length || !clientRows[0].chama_id) {
      return res.status(409).json({ error: 'You are not in a chama' });
    }
    const client = clientRows[0];

    const [acctRows] = await db.query(
      'SELECT id, account_number FROM chama_savings_accounts WHERE chama_id = ? LIMIT 1',
      [client.chama_id]
    );
    if (!acctRows.length) return res.status(500).json({ error: 'Chama savings account not found' });
    const acct = acctRows[0];

    const stkResult = await daraja.stkPush({
      phone: value.phone || client.phone,
      amount: value.amount,
      accountReference: acct.account_number,
      description: 'Chama contribution',
    });

    await db.query(
      'INSERT INTO daraja_requests (client_id, chama_savings_account_id, checkout_request_id, merchant_request_id, phone, amount, direction, status) VALUES (?, ?, ?, ?, ?, ?, \'stk_push\', \'pending\')',
      [client.id, acct.id, stkResult.checkoutRequestId, stkResult.merchantRequestId, value.phone || client.phone, value.amount]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'chama.stk_initiated',
      entityType: 'chama_savings_account',
      entityId: acct.id,
      newValues: { amount: value.amount, checkout_request_id: stkResult.checkoutRequestId },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(function () {});

    res.json({
      ok: true,
      checkout_request_id: stkResult.checkoutRequestId,
      message: 'Check your phone to enter your M-Pesa PIN',
    });
  } catch (err) {
    console.error('[me/chama/contribute]', err.message);
    res.status(500).json({ error: err.message || 'Could not initiate contribution' });
  }
});

// ---------------------------------------------------------------
// GET /chama/contributions — my contribution history
// ---------------------------------------------------------------
router.get('/chama/contributions', authenticate, clientOnly, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT cc.id, cc.period, cc.amount_due, cc.amount_paid, cc.status, cc.last_payment_at
         FROM chama_contributions cc
         JOIN clients cl ON cl.id = cc.client_id
        WHERE cc.client_id = ? AND cc.chama_id = cl.chama_id
        ORDER BY cc.period DESC`,
      [req.clientId]
    );
    res.json({ contributions: rows });
  } catch (err) {
    console.error('[me/chama/contributions]', err.message);
    res.status(500).json({ error: 'Could not load contributions' });
  }
});


// ---------------------------------------------------------------
// POST /chama/invite/:token/accept
// ---------------------------------------------------------------
router.post('/chama/invite/:token/accept', authenticate, clientOnly, async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Token required' });

    // Fetch invite + chama
    const [invRows] = await db.query(
      `SELECT ci.id, ci.chama_id, ci.client_id, ci.email, ci.status, ci.expires_at,
              ch.name AS chama_name, ch.status AS chama_status
         FROM chama_invites ci
         JOIN chamas ch ON ch.id = ci.chama_id
        WHERE ci.token = ? LIMIT 1`,
      [token]
    );
    if (!invRows.length) return res.status(404).json({ error: 'Invite not found' });
    const inv = invRows[0];

    if (inv.status !== 'pending') {
      return res.status(409).json({ error: 'Invite is no longer pending' });
    }
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Invite has expired' });
    }
    if (inv.chama_status !== 'active') {
      return res.status(409).json({ error: 'Chama is not active' });
    }

    // Fetch this client + their email
    const [clientRows] = await db.query(
      `SELECT c.id, c.status, c.chama_id, u.email
         FROM clients c
         JOIN users u ON u.id = c.user_id
        WHERE c.id = ? LIMIT 1`,
      [req.clientId]
    );
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found' });
    const client = clientRows[0];

    if (client.status !== 'active') return res.status(403).json({ error: 'Your account is not active' });
    if (client.chama_id) return res.status(409).json({ error: 'You are already in a chama' });

    // Match by client_id or email
    const emailMatch = inv.email && client.email && inv.email.toLowerCase() === client.email.toLowerCase();
    const clientMatch = inv.client_id && Number(inv.client_id) === Number(client.id);
    if (!emailMatch && !clientMatch) {
      return res.status(403).json({ error: 'This invite is for a different account' });
    }

    // Enrol
    await chama.enrolMember({
      chamaId: inv.chama_id,
      clientId: client.id,
      enrolledBy: null,
    });

    // Mark invite accepted
    await db.query(
      "UPDATE chama_invites SET status='accepted', responded_at=NOW() WHERE id = ?",
      [inv.id]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'chama.invite_accepted',
      entityType: 'chama_invite',
      entityId: inv.id,
      newValues: { chama_id: inv.chama_id, client_id: client.id },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(function () {});

    res.json({ ok: true, chama_id: inv.chama_id, chama_name: inv.chama_name });
  } catch (err) {
    console.error('[me/chama/invite/accept]', err.message);
    res.status(500).json({ error: err.message || 'Could not accept invite' });
  }
});

// ---------------------------------------------------------------
// POST /chama/invite/:token/decline
// ---------------------------------------------------------------
router.post('/chama/invite/:token/decline', authenticate, clientOnly, async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Token required' });

    const [invRows] = await db.query(
      `SELECT ci.id, ci.chama_id, ci.client_id, ci.email, ci.status
         FROM chama_invites ci
        WHERE ci.token = ? LIMIT 1`,
      [token]
    );
    if (!invRows.length) return res.status(404).json({ error: 'Invite not found' });
    const inv = invRows[0];

    if (inv.status !== 'pending') {
      return res.status(409).json({ error: 'Invite is no longer pending' });
    }

    const [clientRows] = await db.query(
      `SELECT c.id, u.email FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ? LIMIT 1`,
      [req.clientId]
    );
    if (!clientRows.length) return res.status(404).json({ error: 'Client not found' });
    const client = clientRows[0];

    const emailMatch = inv.email && client.email && inv.email.toLowerCase() === client.email.toLowerCase();
    const clientMatch = inv.client_id && Number(inv.client_id) === Number(client.id);
    if (!emailMatch && !clientMatch) {
      return res.status(403).json({ error: 'This invite is for a different account' });
    }

    await db.query(
      "UPDATE chama_invites SET status='declined', responded_at=NOW() WHERE id = ?",
      [inv.id]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'client',
      action: 'chama.invite_declined',
      entityType: 'chama_invite',
      entityId: inv.id,
      newValues: { chama_id: inv.chama_id, client_id: client.id },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(function () {});

    res.json({ ok: true });
  } catch (err) {
    console.error('[me/chama/invite/decline]', err.message);
    res.status(500).json({ error: err.message || 'Could not decline invite' });
  }
});

module.exports = router;
