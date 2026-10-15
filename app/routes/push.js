const express = require('express');
const db = require('../db');
const push = require('../services/push');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Public key for the frontend to subscribe with
router.get('/public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: key });
});

// Subscribe this device for a client
router.post('/subscribe', async (req, res) => {
  try {
    if (req.user.role !== 'client') {
      return res.status(403).json({ error: 'Only clients can subscribe' });
    }
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client profile not found' });

    const { subscription } = req.body;
    if (!subscription) return res.status(400).json({ error: 'Missing subscription' });

    await push.subscribe(cl[0].id, subscription, req.get('user-agent'));
    res.json({ ok: true });
  } catch (err) {
    console.error('[push subscribe]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Unsubscribe this device
router.post('/unsubscribe', async (req, res) => {
  try {
    if (req.user.role !== 'client') return res.status(403).json({ error: 'Only clients' });
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

    await push.unsubscribe(cl[0].id, endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin test send (or "send test to my own client account" for testing)
router.post('/test', async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      // Admin can send to a specific client by client_id
      const clientId = Number(req.body.client_id);
      if (!clientId) return res.status(400).json({ error: 'client_id required for admin test' });
      const result = await push.sendToClient(clientId, {
        title: 'Zaria test',
        body: 'This is a test notification from the admin panel.',
        url: '/client/dashboard',
        tag: 'test-' + Date.now(),
      });
      return res.json({ ok: true, ...result });
    }

    // Client: send to own devices
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    const result = await push.sendToClient(cl[0].id, {
      title: 'Zaria',
      body: 'Push notifications are working.',
      url: '/client/dashboard',
      tag: 'test-' + Date.now(),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[push test]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
