const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// Helper: validate a date string YYYY-MM-DD
function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

// ===============================================================
// GET /api/admin/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// ===============================================================
router.get('/summary', async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ error: 'from and to required (YYYY-MM-DD)' });
    }

    // Disbursements in period
    const [disbursements] = await db.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE type = 'disbursement' AND status = 'completed'
          AND DATE(created_at) BETWEEN ? AND ?`,
      [from, to]
    );

    // Repayments in period
    const [repayments] = await db.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM transactions
        WHERE type = 'repayment' AND status = 'completed'
          AND DATE(created_at) BETWEEN ? AND ?`,
      [from, to]
    );

    // New loans created in period
    const [newLoans] = await db.query(
      `SELECT COUNT(*) AS count FROM loans WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to]
    );

    // Loans fully repaid in period
    const [repaidLoans] = await db.query(
      `SELECT COUNT(*) AS count FROM loans
        WHERE status = 'repaid' AND DATE(closed_at) BETWEEN ? AND ?`,
      [from, to]
    );

    // New clients in period
    const [newClients] = await db.query(
      `SELECT COUNT(*) AS count FROM clients WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to]
    );

    // Current portfolio snapshot (not date filtered)
    const [portfolio] = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('active','overdue') THEN total_repayable - amount_repaid ELSE 0 END), 0) AS outstanding,
         COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_count,
         COUNT(CASE WHEN status = 'overdue' THEN 1 END) AS overdue_count,
         COUNT(CASE WHEN status = 'repaid' THEN 1 END) AS repaid_count
       FROM loans`
    );

    res.json({
      from, to,
      disbursements: { count: disbursements[0].count, total: Number(disbursements[0].total) },
      repayments: { count: repayments[0].count, total: Number(repayments[0].total) },
      new_loans: newLoans[0].count,
      repaid_loans: repaidLoans[0].count,
      new_clients: newClients[0].count,
      portfolio: {
        outstanding: Number(portfolio[0].outstanding),
        active_count: portfolio[0].active_count,
        overdue_count: portfolio[0].overdue_count,
        repaid_count: portfolio[0].repaid_count,
      },
    });
  } catch (err) {
    console.error('[reports summary]', err.message);
    res.status(500).json({ error: 'Could not generate report' });
  }
});

// ===============================================================
// GET /api/admin/reports/transactions.csv?from=...&to=...
// ===============================================================
router.get('/transactions.csv', async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).send('Invalid date range');
    }

    const [rows] = await db.query(
      `SELECT t.id, t.created_at, t.type, t.amount, t.mpesa_receipt, t.reference,
              t.status, t.notes,
              l.id AS loan_id, c.full_name AS client_name, c.phone AS client_phone,
              u.email AS recorded_by_email
         FROM transactions t
         JOIN loans l ON l.id = t.loan_id
         JOIN clients c ON c.id = t.client_id
         LEFT JOIN users u ON u.id = t.recorded_by
        WHERE DATE(t.created_at) BETWEEN ? AND ?
        ORDER BY t.created_at ASC`,
      [from, to]
    );

    const header = [
      'ID', 'Date', 'Type', 'Amount', 'M-Pesa Receipt', 'Reference',
      'Status', 'Notes', 'Loan ID', 'Client Name', 'Client Phone', 'Recorded By'
    ];

    function csvEscape(v) {
      if (v == null) return '';
      var s = String(v);
      if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    const lines = [header.join(',')];
    rows.forEach(function (r) {
      lines.push([
        r.id, r.created_at.toISOString(), r.type, r.amount,
        r.mpesa_receipt, r.reference, r.status, r.notes,
        r.loan_id, r.client_name, r.client_phone, r.recorded_by_email,
      ].map(csvEscape).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      'attachment; filename="zaria-transactions-' + from + '-to-' + to + '.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[reports csv]', err.message);
    res.status(500).send('Could not generate CSV');
  }
});

// ===============================================================
// GET /api/admin/reports/loans.csv?from=...&to=...
// ===============================================================
router.get('/loans.csv', async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).send('Invalid date range');
    }

    const [rows] = await db.query(
      `SELECT l.id, l.created_at, l.disbursed_at, l.closed_at,
              l.principal, l.interest_rate, l.term_months,
              l.total_repayable, l.amount_repaid,
              l.status, l.purpose,
              c.id AS client_id, c.full_name AS client_name, c.phone AS client_phone,
              c.national_id
         FROM loans l
         JOIN clients c ON c.id = l.client_id
        WHERE DATE(l.created_at) BETWEEN ? AND ?
        ORDER BY l.created_at ASC`,
      [from, to]
    );

    const header = [
      'ID', 'Created', 'Disbursed', 'Closed', 'Principal', 'Interest Rate',
      'Term (months)', 'Total Repayable', 'Amount Repaid', 'Outstanding',
      'Status', 'Purpose', 'Client ID', 'Client Name', 'Phone', 'National ID'
    ];

    function csvEscape(v) {
      if (v == null) return '';
      var s = String(v);
      if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    const lines = [header.join(',')];
    rows.forEach(function (r) {
      var outstanding = Number(r.total_repayable) - Number(r.amount_repaid);
      lines.push([
        r.id,
        r.created_at ? r.created_at.toISOString() : '',
        r.disbursed_at ? r.disbursed_at.toISOString() : '',
        r.closed_at ? r.closed_at.toISOString() : '',
        r.principal, r.interest_rate, r.term_months,
        r.total_repayable, r.amount_repaid, outstanding.toFixed(2),
        r.status, r.purpose,
        r.client_id, r.client_name, r.client_phone, r.national_id,
      ].map(csvEscape).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      'attachment; filename="zaria-loans-' + from + '-to-' + to + '.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[reports loans csv]', err.message);
    res.status(500).send('Could not generate CSV');
  }
});

// ===============================================================
// GET /api/admin/reports/clients.csv
// ===============================================================
router.get('/clients.csv', async (req, res) => {
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
      var s = String(v);
      if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }
    const lines = [header.join(',')];
    rows.forEach(function (r) {
      lines.push([
        r.id, r.full_name, r.email, r.phone, r.national_id, r.status,
        r.created_at ? r.created_at.toISOString() : '', r.total_loans, r.total_repaid,
      ].map(csvEscape).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="zaria-clients.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[reports clients csv]', err.message);
    res.status(500).send('Could not generate CSV');
  }
});

module.exports = router;
