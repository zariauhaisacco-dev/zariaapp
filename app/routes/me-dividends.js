const express = require('express');
const db = require('../db');
const dividends = require('../services/dividends');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('client'));

// GET /api/me/dividends — my dividend history + totals
router.get('/', async (req, res) => {
  try {
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    const result = await dividends.getClientDividends(cl[0].id);
    res.json(result);
  } catch (err) {
    console.error('[me dividends]', err.message);
    res.status(500).json({ error: 'Could not load dividends' });
  }
});

module.exports = router;
