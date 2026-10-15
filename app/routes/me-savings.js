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

module.exports = router;
