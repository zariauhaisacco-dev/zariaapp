/*
 * Zaria — Admin global search
 *
 * GET /api/admin/search?q=<query>
 * Returns up to 5 matching clients, loans, and transactions.
 * Admin-only. Requires an authenticated admin session.
 */

const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const LIMIT = 5;

router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ query: '', clients: [], loans: [], transactions: [] });
  }
  if (q.length < 2) {
    return res.json({ query: q, clients: [], loans: [], transactions: [], note: 'Type at least 2 characters' });
  }

  const like = '%' + q + '%';
  const numericQ = /^\d+$/.test(q) ? Number(q) : null;

  try {
    const [clients] = await db.query(
      `SELECT id, full_name, phone, national_id, status
         FROM clients
        WHERE full_name LIKE ? OR phone LIKE ? OR national_id LIKE ?
        ORDER BY id DESC
        LIMIT ?`,
      [like, like, like, LIMIT]
    );

    const [loans] = await db.query(
      `SELECT l.id, l.principal, l.status,
              c.full_name AS client_name, c.phone AS client_phone
         FROM loans l
         JOIN clients c ON c.id = l.client_id
        WHERE c.full_name LIKE ? OR c.phone LIKE ?` +
        (numericQ !== null ? ' OR l.id = ?' : '') + `
        ORDER BY l.created_at DESC
        LIMIT ?`,
      numericQ !== null
        ? [like, like, numericQ, LIMIT]
        : [like, like, LIMIT]
    );

    const [transactions] = await db.query(
      `SELECT t.id, t.type, t.amount, t.mpesa_receipt, t.reference, t.created_at,
              c.full_name AS client_name, t.loan_id
         FROM transactions t
         JOIN clients c ON c.id = t.client_id
        WHERE c.full_name LIKE ? OR c.phone LIKE ?
           OR t.mpesa_receipt LIKE ? OR t.reference LIKE ?
        ORDER BY t.created_at DESC
        LIMIT ?`,
      [like, like, like, like, LIMIT]
    );

    res.json({ query: q, clients, loans, transactions });
  } catch (err) {
    console.error('[admin search]', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
