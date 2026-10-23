const express = require('express');
const db = require('../db');
const savings = require('../services/savings');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('client'));

// Get my savings account + recent transactions
router.get('/', async (req, res) => {
  try {
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    let account = await savings.getAccountByClient(cl[0].id);
    let transactions = [];

    if (account) {
      transactions = await savings.listTransactions(account.id, 50);
    }

    res.json({
      account: account || null,
      transactions: transactions,
    });
  } catch (err) {
    console.error('[me savings]', err.message);
    res.status(500).json({ error: 'Could not load savings' });
  }
});

// GET /api/me/savings/eligibility — loan eligibility based on savings
router.get('/eligibility', async (req, res) => {
  try {
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    const elig = await savings.getEligibilityForClient(cl[0].id);
    res.json(elig);
  } catch (err) {
    console.error('[eligibility]', err.message);
    res.status(500).json({ error: 'Could not load eligibility' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/me/savings/monthly
// Returns per-year, per-month NET contribution data.
// Withdrawals are subtracted, interest is excluded.
// ─────────────────────────────────────────────────────────────
router.get('/monthly', async (req, res) => {
  try {
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    const account = await savings.getAccountByClient(cl[0].id);
    if (!account) {
      return res.json({ account: null, years: [], grand_total: 0, last_contribution: null });
    }

    const [rows] = await db.query(
      `SELECT id, type, amount, reference, notes, created_at
         FROM savings_transactions
        WHERE savings_account_id = ?
          AND status = 'completed'
        ORDER BY created_at ASC`,
      [account.id]
    );

    const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const byYear = {};
    rows.forEach(function (r) {
      const d = new Date(r.created_at);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      if (!byYear[y]) {
        byYear[y] = Array.from({ length: 12 }, function (_, i) {
          return { month: i + 1, label: MONTH_LABELS[i], amount: 0, count: 0, refs: [] };
        });
      }

      // Net contribution logic:
      // - withdrawal → subtract
      // - deposit / adjustment → add
      // - interest → excluded from contributions chart
      if (r.type === 'withdrawal') {
        byYear[y][m].amount -= Number(r.amount);
      } else if (r.type === 'deposit' || r.type === 'adjustment') {
        byYear[y][m].amount += Number(r.amount);
      }

      byYear[y][m].count += 1;
      if (r.reference) byYear[y][m].refs.push(r.reference);
    });

    const currentYear = new Date().getUTCFullYear();
    [currentYear, currentYear - 1].forEach(function (y) {
      if (!byYear[y]) {
        byYear[y] = Array.from({ length: 12 }, function (_, i) {
          return { month: i + 1, label: MONTH_LABELS[i], amount: 0, count: 0, refs: [] };
        });
      }
    });

    const years = Object.keys(byYear).map(Number).sort(function (a, b) { return b - a; });

    const out = years.map(function (y) {
      const months = byYear[y];
      const total = months.reduce(function (s, m) { return s + m.amount; }, 0);
      return { year: y, total: total, months: months };
    });

    const grandTotal = out.reduce(function (s, yr) { return s + yr.total; }, 0);
    const lastTxn = rows.length ? rows[rows.length - 1] : null;

    res.json({
      account: {
        account_number: account.account_number,
        balance: Number(account.balance),
        opened_at: account.opened_at,
      },
      years: out,
      grand_total: grandTotal,
      last_contribution: lastTxn ? {
        amount: Number(lastTxn.amount),
        date: lastTxn.created_at,
        reference: lastTxn.reference,
      } : null,
    });
  } catch (err) {
    console.error('[me savings monthly]', err.message);
    res.status(500).json({ error: 'Could not load monthly contributions' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/me/savings/monthly.csv
// Same net-contribution logic: withdrawals negative, interest excluded.
// ─────────────────────────────────────────────────────────────
router.get('/monthly.csv', async (req, res) => {
  try {
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    const account = await savings.getAccountByClient(cl[0].id);
    if (!account) return res.status(404).json({ error: 'No savings account' });

    const [rows] = await db.query(
      `SELECT type, amount, reference, notes, created_at
         FROM savings_transactions
        WHERE savings_account_id = ? AND status = 'completed'
        ORDER BY created_at ASC`,
      [account.id]
    );

    const header = 'Year,Month,Day,Amount,Reference,Notes\n';
    const body = rows.map(function (r) {
      const d = new Date(r.created_at);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      const ref = (r.reference || '').replace(/,/g, ';');
      const notes = (r.notes || '').replace(/,/g, ';');

      // Net amount: withdrawal negative, interest zero, else positive
      let amt;
      if (r.type === 'withdrawal') {
        amt = '-' + Number(r.amount).toFixed(2);
      } else if (r.type === 'interest') {
        amt = '0.00';
      } else {
        amt = Number(r.amount).toFixed(2);
      }

      return [y, m, day, amt, ref, notes].join(',');
    }).join('\n');

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = 'zaria-contributions-' + account.account_number + '-' + dateStr + '.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(header + body + '\n');
  } catch (err) {
    console.error('[me savings monthly csv]', err.message);
    res.status(500).json({ error: 'Could not generate CSV' });
  }
});

module.exports = router;
