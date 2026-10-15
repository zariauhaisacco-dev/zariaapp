const express = require('express');
const Joi = require('joi');
const db = require('../db');
const loans = require('../services/loans');
const audit = require('../services/audit');
const email = require('../services/email');
const push = require('../services/push');
const shares = require('../services/shares');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ===============================================================
// LOAN PRODUCTS
// ===============================================================

router.get('/loan-products', async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, name, min_amount, max_amount, interest_rate, term_months, active
       FROM loan_products
      WHERE active = 1
      ORDER BY min_amount ASC`
  );
  res.json({ products: rows });
});

// ===============================================================
// CLIENTS (for the create-loan picker)
// ===============================================================

router.get('/clients', async (req, res) => {
  const q = (req.query.q || '').trim();
  let where = 'WHERE c.status = "active"';
  const params = [];
  if (q) {
    where += ' AND (c.full_name LIKE ? OR c.phone LIKE ?)';
    params.push('%' + q + '%', '%' + q + '%');
  }
  const [rows] = await db.query(
    `SELECT c.id, c.full_name, c.phone, c.national_id, c.status,
            (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id AND l.status IN ('active','overdue')) AS active_loans
       FROM clients c
       ${where}
       ORDER BY c.full_name ASC
       LIMIT 100`,
    params
  );
  res.json({ clients: rows });
});


// ===============================================================
// CLIENTS — detail + management
// ===============================================================


// ===============================================================
// CLIENTS — export / import
// ===============================================================

// Export clients as CSV
router.get('/clients/export.csv', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.id, c.full_name, c.phone, c.national_id, c.status, c.created_at,
              u.email,
              (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id) AS total_loans,
              (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.client_id = c.id AND t.type = 'repayment' AND t.status = 'completed') AS total_repaid
         FROM clients c
         JOIN users u ON u.id = c.user_id
        ORDER BY c.id ASC`
    );
    const header = ['ID', 'Full Name', 'Email', 'Phone', 'National ID', 'Status', 'Joined', 'Total Loans', 'Total Repaid'];
    function csvEscape(v) {
      if (v == null) return '';
      var str = String(v);
      if (str.indexOf('"') !== -1 || str.indexOf(',') !== -1 || str.indexOf('\n') !== -1) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }
    const lines = [header.join(',')];
    rows.forEach(function (r) {
      lines.push([
        r.id, r.full_name, r.email, r.phone, r.national_id, r.status,
        r.created_at ? r.created_at.toISOString() : '', r.total_loans, r.total_repaid,
      ].map(csvEscape).join(','));
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="zaria-clients-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[clients export]', err.message);
    res.status(500).send('Could not export');
  }
});

// Import clients from CSV (JSON body: { rows: [...] })
// Each row: { full_name, email, phone, national_id, initial_password }
// Skips duplicates by email. Returns per-row result.
router.post('/clients/import', async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to import' });
    if (rows.length > 500) return res.status(400).json({ error: 'Max 500 rows per import' });

    const bcrypt = require('bcryptjs');
    const results = { created: 0, skipped: 0, errors: [] };

    // Validation helpers
    function normalizeKenyanPhone(input) {
      if (!input) return null;
      const digits = String(input).replace(/\D/g, '');
      let local = null;
      if (digits.startsWith('254') && digits.length === 12) local = digits.slice(3);
      else if (digits.startsWith('0') && digits.length === 10) local = digits.slice(1);
      else if (digits.length === 9) local = digits;
      if (!local) return null;
      if (!/^[17]\d{8}$/.test(local)) return null;
      return '254' + local;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 1;

      const fullName = (r.full_name || '').trim();
      const email = (r.email || '').trim().toLowerCase();
      const phone = normalizeKenyanPhone(r.phone);
      const nationalId = (r.national_id || '').trim();
      const password = r.initial_password || 'Zaria@2026';

      if (!fullName || fullName.length < 2) {
        results.errors.push({ row: rowNum, error: 'Invalid full_name' });
        continue;
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        results.errors.push({ row: rowNum, error: 'Invalid email' });
        continue;
      }
      if (!phone) {
        results.errors.push({ row: rowNum, error: 'Invalid Kenyan phone' });
        continue;
      }
      if (!/^\d{7,8}$/.test(nationalId)) {
        results.errors.push({ row: rowNum, error: 'National ID must be 7-8 digits' });
        continue;
      }
      if (password.length < 8) {
        results.errors.push({ row: rowNum, error: 'Password must be 8+ chars' });
        continue;
      }

      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        // Check email uniqueness
        const [existing] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
        if (existing.length) {
          await conn.rollback();
          results.skipped++;
          results.errors.push({ row: rowNum, error: 'Email already registered', email });
          conn.release();
          continue;
        }

        const hash = await bcrypt.hash(password, 12);
        const [userResult] = await conn.query(
          'INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, "client", 1)',
          [email, hash]
        );

        const [clientResult] = await conn.query(
          'INSERT INTO clients (user_id, full_name, phone, national_id, status, created_by) VALUES (?, ?, ?, ?, "active", ?)',
          [userResult.insertId, fullName, phone, nationalId, req.user.id]
        );

        await conn.commit();

        await audit.log({
          actorUserId: req.user.id,
          actorRole: 'admin',
          action: 'client.imported',
          entityType: 'client',
          entityId: clientResult.insertId,
          newValues: { full_name: fullName, email: email, phone: phone },
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        results.created++;
      } catch (e) {
        try { await conn.rollback(); } catch (_) {}
        results.errors.push({ row: rowNum, error: e.message });
      } finally {
        conn.release();
      }
    }

    res.json(results);
  } catch (err) {
    console.error('[clients import]', err.message);
    res.status(500).json({ error: 'Import failed' });
  }
});

// Get one client with their loans + stats
router.get('/clients/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const [rows] = await db.query(
      `SELECT c.id, c.user_id, c.full_name, c.phone, c.national_id, c.status,
              c.created_at, c.created_by,
              u.email, u.must_change_password,
              (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id) AS total_loans,
              (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id AND l.status IN ('active','overdue')) AS active_loans,
              (SELECT COALESCE(SUM(amount), 0) FROM transactions t WHERE t.client_id = c.id AND t.type = 'repayment' AND t.status = 'completed') AS total_repaid,
              (SELECT COALESCE(SUM(amount), 0) FROM transactions t WHERE t.client_id = c.id AND t.type = 'disbursement' AND t.status = 'completed') AS total_borrowed
         FROM clients c
         JOIN users u ON u.id = c.user_id
        WHERE c.id = ?
        LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });

    const client = rows[0];

    const [loans] = await db.query(
      `SELECT id, principal, total_repayable, amount_repaid, status, term_months,
              interest_rate, purpose, disbursed_at, created_at
         FROM loans
        WHERE client_id = ?
        ORDER BY id DESC`,
      [id]
    );

    res.json({ client, loans });
  } catch (err) {
    console.error('[admin client detail]', err.message);
    res.status(500).json({ error: 'Could not load client' });
  }
});

// Update client status (suspend/activate)
router.post('/clients/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!['active', 'suspended', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const [result] = await db.query(
      'UPDATE clients SET status = ? WHERE id = ?',
      [status, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'client.status_changed',
      entityType: 'client',
      entityId: id,
      newValues: { status },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, status });
  } catch (err) {
    console.error('[client status]', err.message);
    res.status(500).json({ error: 'Could not update status' });
  }
});

// Reset client's password (admin action)
router.post('/clients/:id/reset-password', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const [rows] = await db.query(
      'SELECT u.id AS user_id, u.email, c.full_name FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client not found' });

    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(new_password, 12);

    await db.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires_at = NULL, current_session_id = NULL WHERE id = ?',
      [hash, rows[0].user_id]
    );

    // Invalidate their sessions
    await db.query('DELETE FROM sessions WHERE data LIKE ?', ['%userId":"' + rows[0].user_id + '%']).catch(() => {});

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'client.password_reset',
      entityType: 'client',
      entityId: id,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Optionally email the new password to the client — skipped for security
    res.json({ ok: true, email: rows[0].email });
  } catch (err) {
    console.error('[client reset pwd]', err.message);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

// ===============================================================
// LOANS — list & detail
// ===============================================================

router.get('/loans', async (req, res) => {
  const status = req.query.status || 'all';
  const allowed = ['pending', 'approved', 'active', 'overdue', 'repaid', 'defaulted', 'cancelled', 'all'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const q = (req.query.q || '').trim();
  const where = [];
  const params = [];

  if (status !== 'all') { where.push('l.status = ?'); params.push(status); }
  if (q) {
    where.push('(c.full_name LIKE ? OR c.phone LIKE ? OR l.id = ?)');
    params.push('%' + q + '%', '%' + q + '%', isNaN(Number(q)) ? 0 : Number(q));
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [rows] = await db.query(
    `SELECT l.id, l.principal, l.total_repayable, l.amount_repaid, l.status,
            l.interest_rate, l.term_months, l.created_at, l.disbursed_at,
            c.id AS client_id, c.full_name AS client_name, c.phone AS client_phone,
            p.name AS product_name,
            (SELECT MIN(due_date) FROM loan_payments lp
              WHERE lp.loan_id = l.id AND lp.status IN ('pending','partial','overdue')) AS next_due
       FROM loans l
       JOIN clients c ON c.id = l.client_id
       LEFT JOIN loan_products p ON p.id = l.product_id
       ${whereSql}
       ORDER BY l.created_at DESC
       LIMIT 200`,
    params
  );

  const loansOut = rows.map(r => {
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

  res.json({ loans: loansOut });
});

router.get('/loans/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const state = await loans.computeLoanState(id);
  if (!state) return res.status(404).json({ error: 'Loan not found' });

  const transactions = await loans.getTransactions(id);

  res.json({
    loan: state.loan,
    summary: state.summary,
    schedule: state.schedule,
    transactions,
  });
});

// ===============================================================
// LOANS — create / approve / disburse / record payment
// ===============================================================

const createLoanSchema = Joi.object({
  client_id: Joi.number().integer().positive().required(),
  product_id: Joi.number().integer().positive().allow(null).optional(),
  principal: Joi.number().positive().max(10000000).required(),
  interest_rate: Joi.number().min(0).max(0.99).required(),
  term_months: Joi.number().integer().min(1).max(24).required(),
  purpose: Joi.string().max(500).allow('', null),
});

router.post('/loans', async (req, res) => {
  const { error, value } = createLoanSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      error: 'Invalid input',
      details: error.details.map(d => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  try {
    const result = await loans.createLoan({
      clientId: value.client_id,
      productId: value.product_id || null,
      principal: value.principal,
      interestRate: value.interest_rate,
      termMonths: value.term_months,
      purpose: value.purpose || null,
      createdBy: req.user.id,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'loan.created',
      entityType: 'loan',
      entityId: result.loanId,
      newValues: {
        client_id: value.client_id,
        principal: value.principal,
        interest_rate: value.interest_rate,
        term_months: value.term_months,
      },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[loan create]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/loans/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await loans.approveLoan({ loanId: id, adminUserId: req.user.id });
    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'loan.approved',
      entityType: 'loan',
      entityId: id,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[loan approve]', err.message);
    res.status(400).json({ error: err.message });
  }
});

const disburseSchema = Joi.object({
  reference: Joi.string().max(100).allow('', null),
  mpesa_receipt: Joi.string().max(50).allow('', null),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/loans/:id/disburse', async (req, res) => {
  const id = Number(req.params.id);
  const { error, value } = disburseSchema.validate(req.body || {});
  if (error) return res.status(400).json({ error: 'Invalid input' });

  try {
    const result = await loans.disburseLoan({
      loanId: id,
      adminUserId: req.user.id,
      reference: value.reference || null,
      mpesaReceipt: value.mpesa_receipt || null,
      notes: value.notes || null,
    });
    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'loan.disbursed',
      entityType: 'loan',
      entityId: id,
      newValues: { reference: value.reference, mpesa_receipt: value.mpesa_receipt },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
        // Notify client (non-blocking)
    try {
      const [crows] = await db.query(
        "SELECT u.email AS user_email, c.full_name FROM clients c " +
        "JOIN users u ON u.id = c.user_id WHERE c.id = (SELECT client_id FROM loans WHERE id = ?)",
        [id]
      );
      if (crows.length && crows[0].user_email) {
        const [lrows] = await db.query("SELECT principal FROM loans WHERE id = ?", [id]);
        push.notify(crows[0].id, {
          title: "Funds sent",
          body: "KES " + Number(lrows[0].principal).toLocaleString() + " has been sent to your M-Pesa.",
          url: "/client/loans/" + id,
          tag: "disbursed-" + id,
        });
        email.sendLoanDisbursed(crows[0].user_email, {
          client_name: crows[0].full_name,
          amount: Number(lrows[0].principal),
          loan_id: id,
          mpesa_receipt: value.mpesa_receipt || null,
        }).catch(function (e) { console.error("[email disbursed]", e.message); });
      }
    } catch (e) {
      console.error("[notify disburse]", e.message);
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[loan disburse]', err.message);
    res.status(400).json({ error: err.message });
  }
});

const paymentSchema = Joi.object({
  amount: Joi.number().positive().max(10000000).required(),
  mpesa_receipt: Joi.string().max(50).allow('', null),
  reference: Joi.string().max(100).allow('', null),
  notes: Joi.string().max(500).allow('', null),
});

router.post('/loans/:id/payments', async (req, res) => {
  const id = Number(req.params.id);
  const { error, value } = paymentSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      error: 'Invalid input',
      details: error.details.map(d => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  try {
    const result = await loans.recordPayment({
      loanId: id,
      amount: value.amount,
      mpesaReceipt: value.mpesa_receipt || null,
      reference: value.reference || null,
      notes: value.notes || null,
      recordedBy: req.user.id,
    });

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'loan.payment_recorded',
      entityType: 'loan',
      entityId: id,
      newValues: {
        amount: value.amount,
        mpesa_receipt: value.mpesa_receipt,
        reference: value.reference,
        new_total_repaid: result.newTotalRepaid,
      },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

        // Notify client (non-blocking)
    try {
      const [crows] = await db.query(
        "SELECT u.email AS user_email, c.full_name FROM clients c " +
        "JOIN users u ON u.id = c.user_id WHERE c.id = (SELECT client_id FROM loans WHERE id = ?)",
        [id]
      );
      if (crows.length && crows[0].user_email) {
        push.notify(crows[0].id, {
          title: result.fullyRepaid ? "Loan fully repaid" : "Payment received",
          body: "We recorded KES " + Number(value.amount).toLocaleString() + (result.fullyRepaid ? ". Your loan is now closed." : ". Remaining: KES " + Number(result.outstanding).toLocaleString() + "."),
          url: "/client/loans/" + id,
          tag: "payment-" + id,
        });
        email.sendPaymentReceived(crows[0].user_email, {
          client_name: crows[0].full_name,
          amount: value.amount,
          outstanding: result.outstanding,
          loan_id: id,
          mpesa_receipt: value.mpesa_receipt || null,
          fully_repaid: !!result.fullyRepaid,
        }).catch(function (e) { console.error("[email payment-received]", e.message); });
      }
    } catch (e) {
      console.error("[notify payment]", e.message);
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[loan payment]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ===============================================================
// DASHBOARD STATS
// ===============================================================

router.get('/stats', async (req, res) => {
  const [outstandingRow] = await db.query(
    `SELECT COALESCE(SUM(total_repayable - amount_repaid), 0) AS total
       FROM loans
      WHERE status IN ('active','overdue')`
  );

  const [collectedRow] = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
      WHERE type = 'repayment'
        AND status = 'completed'
        AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`
  );

  const [activeRow] = await db.query(
    `SELECT COUNT(*) AS c FROM loans WHERE status IN ('active','overdue')`
  );

  const [overdueRow] = await db.query(
    `SELECT COUNT(*) AS c FROM loans WHERE status = 'overdue'`
  );

  const [pendingRow] = await db.query(
    `SELECT COUNT(*) AS c FROM loans WHERE status IN ('pending','approved')`
  );

  const [pendingRegRow] = await db.query(
    `SELECT COUNT(*) AS c FROM pending_registrations WHERE status = 'pending'`
  );

  // Outstanding vs collected, last 12 weeks (for chart)
  const [weeklyRaw] = await db.query(
    `SELECT
       DATE_FORMAT(created_at, '%Y-%u') AS week,
       SUM(CASE WHEN type = 'repayment' THEN amount ELSE 0 END) AS collected,
       SUM(CASE WHEN type = 'disbursement' THEN amount ELSE 0 END) AS disbursed
       FROM transactions
      WHERE status = 'completed'
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
      GROUP BY week
      ORDER BY week ASC`
  );

  // Build a full 12-week series so the chart always renders 12 points,
  // even if some weeks had no transactions. Missing weeks become zeros.
  const weeklyMap = {};
  weeklyRaw.forEach(function (r) { weeklyMap[r.week] = r; });

  function isoWeekLabel(d) {
    // Match MySQL's DATE_FORMAT(..., '%Y-%u') — %u uses Monday as the first
    // day of the week and returns 00-53 (00 for days before the first Monday).
    var target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var dayNum = target.getUTCDay() || 7;   // Sun=0 -> 7, Mon=1..Sat=6
    target.setUTCDate(target.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
    return target.getUTCFullYear() + '-' + (weekNo < 10 ? '0' + weekNo : String(weekNo));
  }

  const weekly = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 86400000);
    const label = isoWeekLabel(d);
    const match = weeklyMap[label];
    weekly.push({
      week: label,
      collected: match ? match.collected : '0.00',
      disbursed: match ? match.disbursed : '0.00',
    });
  }

  // --- Member funds: savings, shares, dividends ---
  const [savingsRow] = await db.query(
    `SELECT COALESCE(SUM(balance), 0) AS total, COUNT(*) AS accounts
       FROM savings_accounts
      WHERE status = 'active'`
  );

  const [sharesRow] = await db.query(
    `SELECT COALESCE(SUM(shares_held), 0) AS total_shares,
            COUNT(DISTINCT client_id) AS holders
       FROM share_holdings
      WHERE shares_held > 0`
  );

  // Share par value comes from the config table (single source of truth).
  // Fallback to 100 if the config row is missing.
  const shareCfg = await shares.getConfig();
  const shareParValue = shareCfg && shareCfg.par_value
    ? Number(shareCfg.par_value)
    : 100;

  const [dividendsRow] = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'distributed' THEN total_payout ELSE 0 END), 0) AS declared,
       COUNT(CASE WHEN status = 'distributed' THEN 1 END) AS count
       FROM dividend_declarations`
  );

  const [dividendsPaidRow] = await db.query(
    `SELECT COALESCE(SUM(net_amount), 0) AS paid
       FROM dividend_payouts
      WHERE status = 'credited'`
  );

  res.json({
    outstanding: Number(outstandingRow[0].total),
    collected_mtd: Number(collectedRow[0].total),
    active_loans: activeRow[0].c,
    overdue_loans: overdueRow[0].c,
    pending_loans: pendingRow[0].c,
    pending_registrations: pendingRegRow[0].c,
    weekly_series: weekly,
    savings_total: Number(savingsRow[0].total),
    savings_accounts: Number(savingsRow[0].accounts),
    shares_total: Number(sharesRow[0].total_shares),
    shares_holders: Number(sharesRow[0].holders),
    shares_capital: Number(sharesRow[0].total_shares) * shareParValue,
    share_par_value: shareParValue,
    dividends_declared: Number(dividendsRow[0].declared),
    dividends_count: Number(dividendsRow[0].count),
    dividends_paid: Number(dividendsPaidRow[0].paid),
  });
});

module.exports = router;
