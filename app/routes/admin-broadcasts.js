/*
 * Zaria — Admin broadcast routes
 *
 * POST /api/admin/broadcasts/preview  : count recipients
 * POST /api/admin/broadcasts          : create + send
 * GET  /api/admin/broadcasts          : list history
 * GET  /api/admin/broadcasts/:id      : detail
 */

const express = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const broadcast = require('../services/broadcast');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// Rate limit: 1 broadcast per 5 min per admin
const broadcastLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'bc:' + (req.user ? req.user.id : req.ip),
  message: { error: 'Only one broadcast per 5 minutes. Please wait.' },
});

const previewSchema = Joi.object({
  audience_status: Joi.string().valid('active', 'all', 'suspended').default('active'),
});

router.post('/preview', async (req, res) => {
  const { error, value } = previewSchema.validate(req.body || {});
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const counts = await broadcast.previewBroadcast({ audienceStatus: value.audience_status });
    res.json(counts);
  } catch (err) {
    console.error('[broadcast preview]', err.message);
    res.status(500).json({ error: 'Could not preview broadcast' });
  }
});

const createSchema = Joi.object({
  subject: Joi.string().min(3).max(255).required(),
  body: Joi.string().min(5).max(5000).required(),
  channels: Joi.string().valid('email', 'push', 'sms', 'both', 'all').required(),
  audience_status: Joi.string().valid('active', 'all', 'suspended').default('active'),
});

router.post('/', broadcastLimiter, async (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const result = await broadcast.startBroadcast({
      subject: value.subject,
      body: value.body,
      channels: value.channels,
      audienceStatus: value.audience_status,
      adminId: req.user.id,
      adminIp: req.ip,
      adminUserAgent: req.get('user-agent'),
    });
    res.json({ ok: true, broadcast_id: result.id, preview: result.preview });
  } catch (err) {
    console.error('[broadcast create]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const list = await broadcast.listBroadcasts({ limit: 50 });
    res.json({ broadcasts: list });
  } catch (err) {
    console.error('[broadcast list]', err.message);
    res.status(500).json({ error: 'Could not load broadcasts' });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  try {
    const b = await broadcast.getBroadcast(id);
    if (!b) return res.status(404).json({ error: 'Broadcast not found' });
    res.json({ broadcast: b });
  } catch (err) {
    console.error('[broadcast detail]', err.message);
    res.status(500).json({ error: 'Could not load broadcast' });
  }
});

// POST /test-self — send only to the admin's own email
const testSchema = Joi.object({
  subject: Joi.string().min(3).max(255).required(),
  body: Joi.string().min(5).max(5000).required(),
});

router.post('/test-self', async (req, res) => {
  const { error, value } = testSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const email = require('../services/email');
    await email.sendBroadcast(req.user.email, {
      subject: value.subject,
      body: value.body,
    });
    res.json({ ok: true, message: 'Test email sent to ' + req.user.email });
  } catch (err) {
    console.error('[broadcast test-self]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
