const express = require('express');
const Joi = require('joi');
const db = require('../db');
const push = require('../services/push');
const audit = require('../services/audit');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Public key for the frontend to subscribe with
router.get('/public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: key });
});

// ---------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------

const subscribeSchema = Joi.object({
  subscription: Joi.object({
    endpoint: Joi.string().uri().max(500).required(),
    keys: Joi.object({
      p256dh: Joi.string().required(),
      auth: Joi.string().required(),
    }).required(),
  }).required(),
});

const unsubscribeSchema = Joi.object({
  endpoint: Joi.string().uri().max(500).required(),
});

const testSchema = Joi.object({
  client_id: Joi.number().integer().positive().optional(),
});

// Subscribe this device for a client
router.post('/subscribe', async (req, res) => {
  const { error, value } = subscribeSchema.validate(req.body || {}, { abortEarly: false });
  if (error) return res.status(400).json({ error: 'Invalid input', details: error.details.map(d => d.message) });

  try {
    if (req.user.role !== 'client') {
      return res.status(403).json({ error: 'Only clients can subscribe' });
    }
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client profile not found' });

    await push.subscribe(cl[0].id, value.subscription, req.get('user-agent'));
    res.json({ ok: true });
  } catch (err) {
    console.error('[push subscribe]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Unsubscribe this device
router.post('/unsubscribe', async (req, res) => {
  const { error, value } = unsubscribeSchema.validate(req.body || {}, { abortEarly: false });
  if (error) return res.status(400).json({ error: 'Invalid input', details: error.details.map(d => d.message) });

  try {
    if (req.user.role !== 'client') return res.status(403).json({ error: 'Only clients' });
    const [cl] = await db.query('SELECT id FROM clients WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (!cl.length) return res.status(404).json({ error: 'Client not found' });

    await push.unsubscribe(cl[0].id, value.endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin test send (or "send test to my own client account" for testing)
router.post('/test', async (req, res) => {
  const { error, value } = testSchema.validate(req.body || {}, { abortEarly: false });
  if (error) return res.status(400).json({ error: 'Invalid input', details: error.details.map(d => d.message) });

  try {
    if (req.user.role === 'admin') {
      const clientId = value.client_id;
      if (!clientId) return res.status(400).json({ error: 'client_id required for admin test' });
      const result = await push.sendToClient(clientId, {
        title: 'Zaria test',
        body: 'This is a test notification from the admin panel.',
        url: '/client/dashboard',
        tag: 'test-' + Date.now(),
      });

      await audit.log({
        actorUserId: req.user.id,
        actorRole: 'admin',
        action: 'push.test_sent',
        entityType: 'client',
        entityId: clientId,
        newValues: { sent: result.sent, removed: result.removed },
        ip: req.ip,
        userAgent: req.get('user-agent'),
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
