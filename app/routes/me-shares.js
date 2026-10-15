const express = require('express');
const db = require('../db');
const shares = require('../services/shares');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('client'));

// GET /api/me/shares — my shareholding + recent transactions + config
router.get('/', async (req, res) => {
  try {
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    const holding = await shares.getHoldingForClient(cl[0].id);
    const config = await shares.getConfig();

    let transactions = [];
    let currentValue = 0;

    if (holding) {
      transactions = await shares.listTransactions(holding.id, 50);
      currentValue = Math.round(holding.shares_held * config.par_value * 100) / 100;
    }

    res.json({
      has_holding: !!holding,
      holding: holding || null,
      current_value: currentValue,
      config: config,
      transactions: transactions,
    });
  } catch (err) {
    console.error('[me shares]', err.message);
    res.status(500).json({ error: 'Could not load shares' });
  }
});

module.exports = router;
