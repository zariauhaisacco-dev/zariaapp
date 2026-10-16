const express = require('express');
const Joi = require('joi');
const db = require('../db');
const audit = require('../services/audit');
const savings = require('../services/savings');
const uploads = require('../services/uploads');
const daraja = require('../services/daraja');
const cryptoService = require('../services/settings-crypto');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// GET /api/admin/settings/products
router.get('/products', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, min_amount, max_amount, interest_rate, term_months, active FROM loan_products ORDER BY min_amount ASC'
    );
    res.json({ products: rows });
  } catch (err) {
    console.error('[settings products]', err.message);
    res.status(500).json({ error: 'Could not load products' });
  }
});

// POST /api/admin/settings/products/:id
const productSchema = Joi.object({
  min_amount: Joi.number().positive().max(10000000),
  max_amount: Joi.number().positive().max(10000000),
  interest_rate: Joi.number().min(0).max(0.99),
  term_months: Joi.number().integer().min(1).max(24),
  active: Joi.boolean(),
}).min(1);

router.post('/products/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const { error, value } = productSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const [existing] = await db.query('SELECT * FROM loan_products WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Product not found' });
    const before = existing[0];

    const updates = [];
    const params = [];
    ['min_amount', 'max_amount', 'interest_rate', 'term_months', 'active'].forEach(function (k) {
      if (value[k] !== undefined) {
        updates.push(k + ' = ?');
        params.push(value[k]);
      }
    });
    if (!updates.length) return res.json({ ok: true });

    params.push(id);
    await db.query('UPDATE loan_products SET ' + updates.join(', ') + ' WHERE id = ?', params);

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'product.updated',
      entityType: 'loan_product',
      entityId: id,
      oldValues: before,
      newValues: value,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[settings update product]', err.message);
    res.status(500).json({ error: 'Could not update product' });
  }
});

// GET /api/admin/settings/system
router.get('/system', async (req, res) => {
  try {
    const [users] = await db.query('SELECT COUNT(*) AS c FROM users');
    const [clients] = await db.query('SELECT COUNT(*) AS c FROM clients');
    const [loans] = await db.query('SELECT COUNT(*) AS c FROM loans');
    const [txs] = await db.query('SELECT COUNT(*) AS c FROM transactions');
    const [auditRows] = await db.query('SELECT COUNT(*) AS c FROM audit_logs');
    const [subs] = await db.query('SELECT COUNT(*) AS c FROM push_subscriptions');
    const [sessions] = await db.query('SELECT COUNT(*) AS c FROM sessions');
    const [migrations] = await db.query('SELECT COUNT(*) AS c FROM _migrations');
    const [dbSize] = await db.query(
      "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS mb FROM information_schema.TABLES WHERE table_schema = DATABASE()"
    );

    res.json({
      app: {
        name: 'Zaria',
        version: '1.0.0',
        env: process.env.NODE_ENV || 'development',
        started_at: new Date().toISOString(),
      },
      counts: {
        users: users[0].c,
        clients: clients[0].c,
        loans: loans[0].c,
        transactions: txs[0].c,
        audit_events: auditRows[0].c,
        push_subscriptions: subs[0].c,
        active_sessions: sessions[0].c,
        migrations: migrations[0].c,
      },
      db: { size_mb: Number(dbSize[0].mb) || 0 },
      features: {
        push: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        smtp: !!process.env.SMTP_PASS,
        daraja: !!process.env.DARAJA_CONSUMER_KEY,
        sms: !!process.env.AT_API_KEY,
      },
    });
  } catch (err) {
    console.error('[settings system]', err.message);
    res.status(500).json({ error: 'Could not load system info' });
  }
});


// GET /api/admin/settings/eligibility
router.get('/eligibility', async (req, res) => {
  try {
    const s = await savings.getSettings();
    res.json(s);
  } catch (err) {
    console.error('[settings eligibility get]', err.message);
    res.status(500).json({ error: 'Could not load settings' });
  }
});

// POST /api/admin/settings/eligibility
const eligSchema = Joi.object({
  loan_multiplier: Joi.number().positive().max(20).required(),
  min_savings_ratio: Joi.number().min(0).max(1).required(),
  require_savings_for_loan: Joi.boolean().required(),
});

router.post('/eligibility', async (req, res) => {
  const { error, value } = eligSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await savings.updateSetting('loan_multiplier', value.loan_multiplier, req.user.id, conn);
    await savings.updateSetting('min_savings_ratio', value.min_savings_ratio, req.user.id, conn);
    await savings.updateSetting('require_savings_for_loan', value.require_savings_for_loan ? '1' : '0', req.user.id, conn);

    await conn.commit();

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'settings.eligibility_updated',
      entityType: 'app_settings',
      newValues: value,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[settings eligibility update]', err.message);
    res.status(500).json({ error: 'Could not save settings' });
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------
// Branding (logo, name, tagline, mission, vision)
// ---------------------------------------------------------------

const HEX = Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/);

const brandingSchema = Joi.object({
  sacco_name:    Joi.string().min(2).max(120).required(),
  tagline:       Joi.string().max(200).allow('', null),
  mission_short: Joi.string().max(300).allow('', null),
  vision:        Joi.string().max(500).allow('', null),

  color_primary:    HEX,
  color_accent:     HEX,
  color_background: HEX,

  contact_phone:    Joi.string().max(40).allow('', null),
  contact_whatsapp: Joi.string().max(40).allow('', null),
  contact_email:    Joi.string().email().max(120).allow('', null),
  contact_location: Joi.string().max(120).allow('', null),
  contact_hours:    Joi.string().max(120).allow('', null),
});

router.get('/branding', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('sacco_name','tagline','logo_url','mission_short','vision','color_primary','color_accent','color_background','contact_phone','contact_whatsapp','contact_email','contact_location','contact_hours')"
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    res.json({
      sacco_name:    map.sacco_name    || '',
      tagline:       map.tagline       || '',
      logo_url:      map.logo_url      || '',
      mission_short: map.mission_short || '',
      vision:        map.vision        || '',
      color_primary:    map.color_primary    || '',
      color_accent:     map.color_accent     || '',
      color_background: map.color_background || '',
      contact_phone:    map.contact_phone    || '',
      contact_whatsapp: map.contact_whatsapp || '',
      contact_email:    map.contact_email    || '',
      contact_location: map.contact_location || '',
      contact_hours:    map.contact_hours    || '',
    });
  } catch (err) {
    console.error('[settings branding get]', err.message);
    res.status(500).json({ error: 'Could not load branding' });
  }
});

router.post('/branding', async (req, res) => {
  const { error, value } = brandingSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await savings.updateSetting('sacco_name', value.sacco_name, req.user.id, conn);
    await savings.updateSetting('tagline', value.tagline || '', req.user.id, conn);
    await savings.updateSetting('mission_short', value.mission_short || '', req.user.id, conn);
    await savings.updateSetting('vision', value.vision || '', req.user.id, conn);

    // Colors (only update if provided)
    if (value.color_primary)    await savings.updateSetting('color_primary', value.color_primary, req.user.id, conn);
    if (value.color_accent)     await savings.updateSetting('color_accent', value.color_accent, req.user.id, conn);
    if (value.color_background) await savings.updateSetting('color_background', value.color_background, req.user.id, conn);

    // Contact (always save, allow empty)
    await savings.updateSetting('contact_phone', value.contact_phone || '', req.user.id, conn);
    await savings.updateSetting('contact_whatsapp', value.contact_whatsapp || '', req.user.id, conn);
    await savings.updateSetting('contact_email', value.contact_email || '', req.user.id, conn);
    await savings.updateSetting('contact_location', value.contact_location || '', req.user.id, conn);
    await savings.updateSetting('contact_hours', value.contact_hours || '', req.user.id, conn);

    await conn.commit();

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'settings.branding_updated',
      entityType: 'app_settings',
      newValues: value,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[settings branding update]', err.message);
    res.status(500).json({ error: 'Could not save branding' });
  } finally {
    conn.release();
  }
});

// POST /api/admin/settings/logo — upload new logo
function handleLogoMulter(req, res, next) {
  uploads.uploadPhoto(req, res, function (err) {
    if (err) {
      console.error('[settings logo] multer:', err.message);
      var msg = 'Upload failed';
      if (/File too large/i.test(err.message)) msg = 'File is too large (max 2 MB)';
      else if (/Unsupported file type/i.test(err.message)) msg = 'Only JPG, PNG, or WebP allowed';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

router.post('/logo', handleLogoMulter, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const [rows] = await db.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'logo_url' LIMIT 1"
    );
    const oldUrl = rows.length ? rows[0].setting_value : '';
    if (oldUrl && oldUrl !== 'logo.png' && oldUrl !== req.file.filename) {
      uploads.deleteFile(oldUrl);
    }

    const rel = uploads.relFor(req.file.filename);
    await savings.updateSetting('logo_url', rel, req.user.id, null);

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'settings.logo_uploaded',
      entityType: 'app_settings',
      newValues: { filename: req.file.filename, size: req.file.size },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, url: '/api/branding/logo?v=' + Date.now() });
  } catch (err) {
    console.error('[settings logo]', err.message);
    res.status(500).json({ error: 'Could not save logo' });
  }
});

// DELETE /api/admin/settings/logo
router.delete('/logo', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'logo_url' LIMIT 1"
    );
    const oldUrl = rows.length ? rows[0].setting_value : '';
    if (oldUrl && oldUrl !== 'logo.png') {
      uploads.deleteFile(oldUrl);
    }

    await savings.updateSetting('logo_url', 'logo.png', req.user.id, null);

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'settings.logo_reset',
      entityType: 'app_settings',
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[settings logo delete]', err.message);
    res.status(500).json({ error: 'Could not reset logo' });
  }
});


// ---------------------------------------------------------------
// Daraja (M-Pesa) settings
// ---------------------------------------------------------------

// Mask a value for display: keep first 6 chars, add ellipsis
function maskValue(v) {
  if (!v) return '';
  const s = String(v);
  if (s.length <= 8) return '••••';
  return s.slice(0, 6) + '…' + s.slice(-4);
}

router.get('/daraja', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'daraja_%'"
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });

    // Determine source for each field
    const envFallbacks = {
      env: process.env.DARAJA_ENV,
      shortcode: process.env.DARAJA_SHORTCODE,
      consumerKey: process.env.DARAJA_CONSUMER_KEY,
      callbackUrl: process.env.DARAJA_CALLBACK_URL,
    };

    const sources = {
      env: map.daraja_env ? 'db' : (envFallbacks.env ? 'env' : 'unset'),
      shortcode: map.daraja_shortcode ? 'db' : (envFallbacks.shortcode ? 'env' : 'unset'),
      consumer_key: map.daraja_consumer_key ? 'db' : (envFallbacks.consumerKey ? 'env' : 'unset'),
      consumer_secret: map.daraja_consumer_secret_enc ? 'db' : (process.env.DARAJA_CONSUMER_SECRET ? 'env' : 'unset'),
      passkey: map.daraja_passkey_enc ? 'db' : (process.env.DARAJA_PASSKEY ? 'env' : 'unset'),
    };

    res.json({
      env: map.daraja_env || envFallbacks.env || 'sandbox',
      shortcode: map.daraja_shortcode || envFallbacks.shortcode || '',
      consumer_key: maskValue(map.daraja_consumer_key || envFallbacks.consumerKey || ''),
      has_consumer_secret: !!(map.daraja_consumer_secret_enc || process.env.DARAJA_CONSUMER_SECRET),
      has_passkey: !!(map.daraja_passkey_enc || process.env.DARAJA_PASSKEY),
      callback_url: map.daraja_callback_url || envFallbacks.callbackUrl || 'https://zariauhai.com/api/daraja/callback',
      b2c: {
        shortcode: map.daraja_b2c_shortcode || '',
        initiator_name: map.daraja_b2c_initiator_name || '',
        has_initiator_pass: !!map.daraja_b2c_initiator_pass_enc,
      },
      encryption_configured: cryptoService.isConfigured(),
      sources: sources,
    });
  } catch (err) {
    console.error('[settings daraja get]', err.message);
    res.status(500).json({ error: 'Could not load Daraja settings' });
  }
});

const darajaSchema = Joi.object({
  env: Joi.string().valid('sandbox', 'production').required(),
  shortcode: Joi.string().max(20).allow('', null),
  consumer_key: Joi.string().max(120).allow('', null),
  consumer_secret: Joi.string().max(200).allow('', null),   // blank = keep existing
  passkey: Joi.string().max(200).allow('', null),           // blank = keep existing
  callback_url: Joi.string().uri().max(300).allow('', null),
  b2c_shortcode: Joi.string().max(20).allow('', null),
  b2c_initiator_name: Joi.string().max(60).allow('', null),
  b2c_initiator_pass: Joi.string().max(200).allow('', null),// blank = keep existing
});

router.post('/daraja', async (req, res) => {
  const { error, value } = darajaSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  if (!cryptoService.isConfigured()) {
    return res.status(500).json({
      error: 'APP_ENCRYPTION_KEY is not set on the server. Cannot save credentials securely.',
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await savings.updateSetting('daraja_env', value.env, req.user.id, conn);
    await savings.updateSetting('daraja_shortcode', value.shortcode || '', req.user.id, conn);
    await savings.updateSetting('daraja_consumer_key', value.consumer_key || '', req.user.id, conn);
    await savings.updateSetting('daraja_callback_url', value.callback_url || 'https://zariauhai.com/api/daraja/callback', req.user.id, conn);
    await savings.updateSetting('daraja_b2c_shortcode', value.b2c_shortcode || '', req.user.id, conn);
    await savings.updateSetting('daraja_b2c_initiator_name', value.b2c_initiator_name || '', req.user.id, conn);

    // Only update secrets if provided (blank = keep existing)
    const changedFields = ['env', 'shortcode', 'consumer_key', 'callback_url', 'b2c_shortcode', 'b2c_initiator_name'];

    if (value.consumer_secret) {
      await savings.updateSetting('daraja_consumer_secret_enc', cryptoService.encrypt(value.consumer_secret), req.user.id, conn);
      changedFields.push('consumer_secret');
    }
    if (value.passkey) {
      await savings.updateSetting('daraja_passkey_enc', cryptoService.encrypt(value.passkey), req.user.id, conn);
      changedFields.push('passkey');
    }
    if (value.b2c_initiator_pass) {
      await savings.updateSetting('daraja_b2c_initiator_pass_enc', cryptoService.encrypt(value.b2c_initiator_pass), req.user.id, conn);
      changedFields.push('b2c_initiator_pass');
    }

    await conn.commit();

    // Force the Daraja service to reload its cached config
    daraja.reloadConfig();

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'settings.daraja_updated',
      entityType: 'app_settings',
      newValues: { fields_changed: changedFields, env: value.env },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ ok: true, fields_changed: changedFields });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[settings daraja update]', err.message);
    res.status(500).json({ error: 'Could not save Daraja settings' });
  } finally {
    conn.release();
  }
});

router.post('/daraja/test', async (req, res) => {
  try {
    if (!(await daraja.isConfigured())) {
      return res.status(400).json({ ok: false, error: 'Daraja credentials are incomplete' });
    }
    // Force fresh token
    daraja.invalidateToken();
    const token = await daraja.getToken();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'No token returned' });
    }
    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'settings.daraja_test_succeeded',
      entityType: 'app_settings',
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[settings daraja test]', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});


module.exports = router;
