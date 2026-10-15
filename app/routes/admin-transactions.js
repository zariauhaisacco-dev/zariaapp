const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ===============================================================
// GET /api/admin/transactions
// Query params:
//   page=1, per_page=50 (max 500)
//   type=disbursement|repayment|late_fee|adjustment
//   status=pending|completed|failed|reversed
//   q=<search by client name, phone, mpesa receipt, reference>
//   loan_id=<number>
//   client_id=<number>
//   from=YYYY-MM-DD, to=YYYY-MM-DD
// ===============================================================
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(500, Math.max(1, parseInt(req.query.per_page, 10) || 50));
    const offset = (page - 1) * perPage;

    const where = [];
    const params = [];

    if (req.query.type) {
      where.push('t.type = ?');
      params.push(req.query.type);
    }
    if (req.query.status) {
      where.push('t.status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      where.push('(c.full_name LIKE ? OR c.phone LIKE ? OR t.mpesa_receipt LIKE ? OR t.reference LIKE ?)');
      const like = '%' + req.query.q + '%';
      params.push(like, like, like, like);
    }
    if (req.query.loan_id) {
      where.push('t.loan_id = ?');
      params.push(parseInt(req.query.loan_id, 10));
    }
    if (req.query.client_id) {
      where.push('t.client_id = ?');
      params.push(parseInt(req.query.client_id, 10));
    }
    if (req.query.from) {
      where.push('t.created_at >= ?');
      params.push(req.query.from + ' 00:00:00');
    }
    if (req.query.to) {
      where.push('t.created_at <= ?');
      params.push(req.query.to + ' 23:59:59');
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Total count
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM transactions t
         JOIN clients c ON c.id = t.client_id
         ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    // Totals (sum of completed amounts in this filter)
    const [sumRows] = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN t.type = 'disbursement' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_disbursed,
         COALESCE(SUM(CASE WHEN t.type = 'repayment' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS total_repaid
         FROM transactions t
         JOIN clients c ON c.id = t.client_id
         ${whereSql}`,
      params
    );

    // Fetch rows
    const [rows] = await db.query(
      `SELECT t.id, t.loan_id, t.client_id, t.type, t.amount,
              t.mpesa_receipt, t.reference, t.status, t.notes,
              t.recorded_by, t.created_at,
              c.full_name AS client_name, c.phone AS client_phone,
              u.email AS recorded_by_email
         FROM transactions t
         JOIN clients c ON c.id = t.client_id
         LEFT JOIN users u ON u.id = t.recorded_by
         ${whereSql}
         ORDER BY t.id DESC
         LIMIT ? OFFSET ?`,
      params.concat([perPage, offset])
    );

    res.json({
      total,
      page,
      per_page: perPage,
      pages: Math.ceil(total / perPage),
      totals: {
        disbursed: Number(sumRows[0].total_disbursed),
        repaid: Number(sumRows[0].total_repaid),
      },
      transactions: rows.map(r => ({
        ...r,
        amount: Number(r.amount),
      })),
    });
  } catch (err) {
    console.error('[admin transactions]', err.message);
    res.status(500).json({ error: 'Could not load transactions' });
  }
});

// ===============================================================
// GET /api/admin/transactions/export.csv
// ===============================================================
router.get('/export.csv', async (req, res) => {
  try {
    const where = [];
    const params = [];

    if (req.query.type) { where.push('t.type = ?'); params.push(req.query.type); }
    if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
    if (req.query.q) {
      where.push('(c.full_name LIKE ? OR c.phone LIKE ? OR t.mpesa_receipt LIKE ? OR t.reference LIKE ?)');
      const like = '%' + req.query.q + '%';
      params.push(like, like, like, like);
    }
    if (req.query.loan_id) { where.push('t.loan_id = ?'); params.push(parseInt(req.query.loan_id, 10)); }
    if (req.query.client_id) { where.push('t.client_id = ?'); params.push(parseInt(req.query.client_id, 10)); }
    if (req.query.from) { where.push('t.created_at >= ?'); params.push(req.query.from + ' 00:00:00'); }
    if (req.query.to) { where.push('t.created_at <= ?'); params.push(req.query.to + ' 23:59:59'); }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT t.id, t.created_at, t.type, t.amount, t.mpesa_receipt, t.reference,
              t.status, t.notes,
              t.loan_id, c.full_name AS client_name, c.phone AS client_phone,
              u.email AS recorded_by_email
         FROM transactions t
         JOIN clients c ON c.id = t.client_id
         LEFT JOIN users u ON u.id = t.recorded_by
         ${whereSql}
         ORDER BY t.id DESC
         LIMIT 50000`,
      params
    );

    const header = ['ID', 'Date', 'Type', 'Amount', 'M-Pesa Receipt', 'Reference',
                    'Status', 'Notes', 'Loan ID', 'Client Name', 'Phone', 'Recorded By'];
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
        r.id,
        r.created_at ? r.created_at.toISOString() : '',
        r.type, r.amount, r.mpesa_receipt, r.reference,
        r.status, r.notes, r.loan_id, r.client_name, r.client_phone,
        r.recorded_by_email,
      ].map(csvEscape).join(','));
    });

    const from = req.query.from || 'all';
    const to = req.query.to || 'all';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      'attachment; filename="zaria-transactions-' + from + '-to-' + to + '.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[admin transactions csv]', err.message);
    res.status(500).send('Could not export');
  }
});

module.exports = router;
