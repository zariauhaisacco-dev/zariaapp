const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const db = require('../db');
const audit = require('../services/audit');
const email = require('../services/email');
const emailValidate = require('../services/email-validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

// A dummy hash used to burn time when user not found (timing defense)
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1ZxV0nH8Z1w1w1w1w1w1w1w1w1w1w1w';

const loginSchema = Joi.object({
  email: Joi.string().email().required().max(255),
  password: Joi.string().min(8).max(200).required(),
});

// --- POST /api/auth/login ---
router.post('/login', authLimiter, async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const email = value.email.toLowerCase().trim();
    const { password } = value;

    const [rows] = await db.query(
      'SELECT id, email, password_hash, role, current_session_id FROM users WHERE email = ?',
      [email]
    );

    if (!rows.length) {
      // Burn time to match bcrypt compare
      await bcrypt.compare(password, DUMMY_HASH);
      await audit.log({
        actorRole: 'system',
        action: 'login.failed',
        entityType: 'user',
        entityId: null,
        newValues: { email, reason: 'user_not_found' },
        ip,
        userAgent: ua,
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      await audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'login.failed',
        entityType: 'user',
        entityId: user.id,
        newValues: { reason: 'bad_password' },
        ip,
        userAgent: ua,
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate sessionId for single-admin enforcement
    const sessionId = crypto.randomBytes(32).toString('hex');

    // Regenerate session to prevent fixation
    req.session.regenerate(async (err) => {
      if (err) {
        console.error('[login regenerate]', err.message);
        return res.status(500).json({ error: 'Login failed' });
      }

      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.sessionId = sessionId;

      // For admins, overwrite current_session_id — kills any other session
      if (user.role === 'admin') {
        await db.query(
          'UPDATE users SET current_session_id = ? WHERE id = ?',
          [sessionId, user.id]
        );
      }

      // Clear any old password reset tokens on successful login
      await db.query(
        'UPDATE users SET reset_token = NULL, reset_expires_at = NULL WHERE id = ?',
        [user.id]
      );

      await audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'login.success',
        entityType: 'user',
        entityId: user.id,
        ip,
        userAgent: ua,
      });

      const redirect = user.role === 'admin' ? '/admin/dashboard' : '/client/dashboard';

      res.json({
        user: { id: user.id, email: user.email, role: user.role },
        redirect,
      });
    });
  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- POST /api/auth/logout ---
router.post('/logout', async (req, res) => {
  const userId = req.session?.userId;
  const role = req.session?.role;
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  if (userId) {
    await audit.log({
      actorUserId: userId,
      actorRole: role || 'system',
      action: 'logout',
      entityType: 'user',
      entityId: userId,
      ip,
      userAgent: ua,
    });
  }

  req.session.destroy(() => {
    res.clearCookie('zaria.sid');
    res.json({ ok: true });
  });
});

// --- GET /api/me ---
router.get('/me', authenticate, (req, res) => {
  res.json({
    user: { id: req.user.id, email: req.user.email, role: req.user.role },
  });
});


// ---------------------------------------------------------------
// POST /forgot-password — send a reset link
// ---------------------------------------------------------------
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again in an hour.' },
});

const forgotSchema = Joi.object({
  email: Joi.string().email().required().max(255),
});

router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    const { error, value } = forgotSchema.validate(req.body);
    // Always return the same message — do not leak whether the email exists
    const GENERIC = { message: 'If that email is registered, we\'ve sent a reset link.' };
    if (error) return res.json(GENERIC);

    const emailLower = value.email.toLowerCase().trim();

    // If the domain can't receive mail, silently skip (do NOT leak that it
    // was rejected — same generic response as an unknown email).
    const mxOk = await emailValidate.hasValidMx(emailLower);
    if (!mxOk) {
      await audit.log({
        actorRole: 'system',
        action: 'password_reset.requested_bad_domain',
        entityType: 'user',
        newValues: { email: emailLower },
        ip, userAgent: ua,
      });
      return res.json(GENERIC);
    }

    const [rows] = await db.query(
      'SELECT id, email, role FROM users WHERE email = ? LIMIT 1',
      [emailLower]
    );

    if (!rows.length) {
      await audit.log({
        actorRole: 'system',
        action: 'password_reset.requested_unknown',
        entityType: 'user',
        newValues: { email: emailLower },
        ip, userAgent: ua,
      });
      return res.json(GENERIC);
    }

    const user = rows[0];

    // Generate a random token; store only its SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');

    await db.query(
      'UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE id = ?',
      [hashed, new Date(Date.now() + 60 * 60 * 1000), user.id]  // 1-hour expiry
    );

    const baseUrl = process.env.APP_URL || 'https://zariauhai.com';
    const resetUrl = baseUrl + '/reset-password?token=' + rawToken;

    await email.send({
      to: user.email,
      subject: 'Reset your Zaria password',
      html: email.wrap('Reset password', `
        <h1 style="margin:0 0 10px;font-size:20px;">Reset your password</h1>
        <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
          We received a request to reset your Zaria password. Click the button below to set a new one.
          This link expires in 1 hour.
        </p>
        <p style="margin:22px 0;">${email.button(resetUrl, 'Reset password')}</p>
        <p style="margin:0 0 14px;line-height:1.55;color:#2A3342;">
          If you did not request this, ignore this email — your password won't change.
        </p>
        <p style="margin:22px 0 0;color:#6B7484;font-size:13px;">— The Zaria team</p>
      `),
    });

    await audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'password_reset.requested',
      entityType: 'user',
      entityId: user.id,
      ip, userAgent: ua,
    });

    res.json(GENERIC);
  } catch (err) {
    console.error('[forgot-password]', err.message);
    res.json({ message: 'If that email is registered, we\'ve sent a reset link.' });
  }
});

// ---------------------------------------------------------------
// POST /reset-password — consume the token and set new password
// ---------------------------------------------------------------
const resetSchema = Joi.object({
  token: Joi.string().length(64).hex().required(),
  password: Joi.string().min(8).max(200).required(),
});

router.post('/reset-password', async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    const { error, value } = resetSchema.validate(req.body);
    if (error) return res.status(400).json({ error: 'Invalid input' });

    const hashed = crypto.createHash('sha256').update(value.token).digest('hex');

    const [rows] = await db.query(
      'SELECT id, email, role FROM users WHERE reset_token = ? AND reset_expires_at > NOW() LIMIT 1',
      [hashed]
    );

    if (!rows.length) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const user = rows[0];
    const newHash = await bcrypt.hash(value.password, 12);

    await db.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires_at = NULL, current_session_id = NULL WHERE id = ?',
      [newHash, user.id]
    );

    // Invalidate all existing sessions for this user
    await db.query('DELETE FROM sessions WHERE data LIKE ?', ['%' + 'userId":"' + user.id + '%']).catch(() => {});

    await audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'password_reset.completed',
      entityType: 'user',
      entityId: user.id,
      ip, userAgent: ua,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[reset-password]', err.message);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

module.exports = router;
