/*
 * Zaria — Admin notifications
 * GET /api/admin/notifications
 * Returns a compact list of items needing attention.
 */
const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

router.get('/', async (req, res) => {
  try {
    const items = [];

    const [regs] = await db.query(
      `SELECT COUNT(*) AS n FROM pending_registrations WHERE status = 'pending'`
    );
    if (regs[0].n > 0) {
      items.push({
        type: 'registration',
        title: regs[0].n + ' pending registration' + (regs[0].n === 1 ? '' : 's'),
        href: '/admin/registrations',
      });
    }

    const [reqs] = await db.query(
      `SELECT COUNT(*) AS n FROM loan_requests WHERE status = 'pending'`
    );
    if (reqs[0].n > 0) {
      items.push({
        type: 'request',
        title: reqs[0].n + ' loan request' + (reqs[0].n === 1 ? '' : 's') + ' awaiting review',
        href: '/admin/requests',
      });
    }

    const [od] = await db.query(
      `SELECT COUNT(*) AS n FROM loans WHERE status = 'overdue'`
    );
    if (od[0].n > 0) {
      items.push({
        type: 'overdue',
        title: od[0].n + ' loan' + (od[0].n === 1 ? '' : 's') + ' overdue',
        href: '/admin/loans?status=overdue',
      });
    }

    res.json({ count: items.length, items });
  } catch (err) {
    console.error('[admin notifications]', err.message);
    res.status(500).json({ error: 'Could not load notifications' });
  }
});

module.exports = router;
