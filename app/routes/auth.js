/* Zaria — Auth routes
 * Login (with admin 2FA), logout, forgot password, reset password.
 * Admin 2FA: after password verify, admin gets OTP via SMS/email.
 * Clients: unchanged password-only login.
 */
'use strict';

const express = require('express');
const Joi = require('joi');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const email = require('../services/email');
const audit = require('../services/audit');
const otp = require('../services/otp');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Bcrypt dummy hash — used to burn time when user not found
const DUMMY_HASH = '$2a$12$aaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// ---------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Try again in 15 minutes.' },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Try again in 15 minutes.' },
});

// ---------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(200).required(),
});

const verifyOtpSchema = Joi.object({
  challengeId: Joi.number().integer().positive().required(),
  code: Joi.string().length(6).pattern(/^\d+$/).required(),
});

const resendOtpSchema = Joi.object({
  challengeId: Joi.number().integer().positive().required(),
  channel: Joi.string().valid('sms', 'email').required(),
});

// ---------------------------------------------------------------
// Shared: complete login (create session, audit, etc.)
// Called from both password-only flow (client) and post-OTP (admin)
// ---------------------------------------------------------------
async function completeLogin(req, res, user, ip, ua, viaTwoFactor) {
  const sessionId = crypto.randomBytes(32).toString('hex');

  req.session.regenerate(async function (err) {
    if (err) {
      console.error('[login regenerate]', err.message);
      return res.status(500).json({ error: 'Login failed' });
    }

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.sessionId = sessionId;

    // For admins, overwrite current_session_id — kills any other admin session
    if (user.role === 'admin') {
      await db.query(
        'UPDATE users SET current_session_id = ? WHERE id = ?',
        [sessionId, user.id]
      );
    }

    // Clear old password reset tokens on successful login
    await db.query(
      'UPDATE users SET reset_token = NULL, reset_expires_at = NULL WHERE id = ?',
      [user.id]
    );

    await audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: viaTwoFactor ? 'login.success_2fa' : 'login.success',
      entityType: 'user',
      entityId: user.id,
      ip,
      userAgent: ua,
    });

    const redirect = user.role === 'admin' ? '/admin/dashboard' : '/client/dashboard';
    res.json({ ok: true, redirect });
  });
}

// ---------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------
router.post('/login', authLimiter, async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(401).json({ error: 'Invalid email or password.' });

    const loginEmail = value.email.toLowerCase().trim();
    const { password } = value;

    const [rows] = await db.query(
      'SELECT id, email, phone, password_hash, role, current_session_id FROM users WHERE email = ?',
      [loginEmail]
    );

    if (!rows.length) {
      await bcrypt.compare(password, DUMMY_HASH);
      await audit.log({
        actorRole: 'system',
        action: 'login.failed',
        entityType: 'user',
        entityId: null,
        newValues: { email: loginEmail, reason: 'user_not_found' },
        ip, userAgent: ua,
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
        ip, userAgent: ua,
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // ─── Admin 2FA branch ─────────────────────────────────
    if (user.role === 'admin' && user.phone) {
      // Send OTP via SMS (primary), no session created yet
      const result = await otp.sendChallenge(user.id, 'sms', user.email, user.phone);

      if (!result.ok) {
        await audit.log({
          actorUserId: user.id,
          actorRole: 'admin',
          action: 'login.2fa_send_failed',
          entityType: 'user',
          entityId: user.id,
          newValues: { error: result.error, message: result.message },
          ip, userAgent: ua,
        });
        return res.status(500).json({
          error: 'Could not send verification code. Try resending via email.',
          canTryEmail: true,
          userId: user.id,
        });
      }

      await audit.log({
        actorUserId: user.id,
        actorRole: 'admin',
        action: 'login.2fa_sent',
        entityType: 'user',
        entityId: user.id,
        newValues: { channel: result.sentTo, maskedTo: result.maskedTo },
        ip, userAgent: ua,
      });

      return res.json({
        requires2fa: true,
        challengeId: result.challengeId,
        sentTo: result.sentTo,
        maskedTo: result.maskedTo,
        canFallbackEmail: true,
        emailMasked: otp.maskEmail(user.email),
      });
    }

    // ─── Client (or admin without phone): immediate session ──
    await completeLogin(req, res, user, ip, ua, false);

  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ---------------------------------------------------------------
// POST /api/auth/verify-otp
// ---------------------------------------------------------------
router.post('/verify-otp', otpVerifyLimiter, async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    const { error, value } = verifyOtpSchema.validate(req.body);
    if (error) return res.status(400).json({ error: 'Invalid input' });

    const result = await otp.verifyChallenge(value.challengeId, value.code);

    if (!result.ok) {
      const msgs = {
        not_found: 'Code not found. Please log in again.',
        already_used: 'This code has already been used. Please log in again.',
        expired: 'Code has expired. Please log in again.',
        locked_out: 'Too many wrong attempts. Please log in again.',
        invalid: 'Incorrect code.' + (result.attemptsRemaining !== undefined ? ' ' + result.attemptsRemaining + ' attempts remaining.' : ''),
      };
      await audit.log({
        actorRole: 'system',
        action: 'login.2fa_verify_failed',
        entityType: 'login_challenge',
        entityId: value.challengeId,
        newValues: { reason: result.error },
        ip, userAgent: ua,
      });
      return res.status(401).json({
        error: msgs[result.error] || 'Verification failed',
        reason: result.error,
        attemptsRemaining: result.attemptsRemaining,
      });
    }

    // OTP verified. Load user and complete login.
    const [users] = await db.query(
      'SELECT id, email, phone, role FROM users WHERE id = ? LIMIT 1',
      [result.userId]
    );
    if (!users.length) return res.status(401).json({ error: 'User not found' });

    await completeLogin(req, res, users[0], ip, ua, true);

  } catch (err) {
    console.error('[verify-otp]', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ---------------------------------------------------------------
// POST /api/auth/resend-otp
// ---------------------------------------------------------------
router.post('/resend-otp', otpSendLimiter, async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    const { error, value } = resendOtpSchema.validate(req.body);
    if (error) return res.status(400).json({ error: 'Invalid input' });

    // Load existing challenge to find user_id
    const [rows] = await db.query(
      'SELECT user_id, status FROM login_challenges WHERE id = ? LIMIT 1',
      [value.challengeId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Challenge not found' });
    if (rows[0].status !== 'pending') {
      return res.status(409).json({ error: 'This challenge is already used. Please log in again.' });
    }

    const userId = rows[0].user_id;

    const [users] = await db.query(
      'SELECT id, email, phone, role FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!users.length) return res.status(404).json({ error: 'User not found' });
    const user = users[0];

    if (user.role !== 'admin') {
      return res.status(403).json({ error: '2FA resend only available for admin accounts' });
    }

    const result = await otp.sendChallenge(user.id, value.channel, user.email, user.phone);

    if (!result.ok) {
      return res.status(400).json({
        error: result.message || 'Could not send code',
        reason: result.error,
      });
    }

    await audit.log({
      actorUserId: user.id,
      actorRole: 'admin',
      action: 'login.2fa_resent',
      entityType: 'user',
      entityId: user.id,
      newValues: { channel: result.sentTo, maskedTo: result.maskedTo },
      ip, userAgent: ua,
    });

    res.json({
      ok: true,
      challengeId: result.challengeId,
      sentTo: result.sentTo,
      maskedTo: result.maskedTo,
    });

  } catch (err) {
    console.error('[resend-otp]', err.message);
    res.status(500).json({ error: 'Could not resend code' });
  }
});

// ---------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------
router.post('/logout', async (req, res) => {
  try {
    if (req.session && req.session.userId) {
      await audit.log({
        actorUserId: req.session.userId,
        actorRole: req.session.role || 'unknown',
        action: 'logout',
        entityType: 'user',
        entityId: req.session.userId,
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
      });
    }
    req.session.destroy(function () {});
    res.json({ ok: true });
  } catch (err) {
    console.error('[logout]', err.message);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ---------------------------------------------------------------
// POST /api/auth/forgot-password
// ---------------------------------------------------------------
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Try again later.' },
});

const forgotSchema = Joi.object({ email: Joi.string().email().required() });

router.post('/forgot-password', forgotLimiter, async (req, res) => {
  try {
    const { error, value } = forgotSchema.validate(req.body);
    if (error) return res.json({ ok: true }); // don't leak

    const loginEmail = value.email.toLowerCase().trim();

    // Never confirm or deny whether email exists
    const [rows] = await db.query(
      'SELECT id, email, role FROM users WHERE email = ? LIMIT 1',
      [loginEmail]
    );

    if (!rows.length) {
      await audit.log({
        actorRole: 'system',
        action: 'password_reset.requested_unknown',
        entityType: 'user',
        entityId: null,
        newValues: { email: loginEmail },
        ip: req.ip,
      });
      return res.json({ ok: true });
    }

    const user = rows[0];
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      'UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE id = ?',
      [hashedToken, expiresAt, user.id]
    );

    const baseUrl = process.env.APP_BASE_URL || 'https://zariauhai.com';
    const resetUrl = baseUrl + '/reset-password?token=' + rawToken;

    try {
      await email.send({
        to: user.email,
        subject: 'Reset your Zaria password',
        html: '<p>Click the link below to reset your password:</p>' +
              '<p><a href="' + resetUrl + '">' + resetUrl + '</a></p>' +
              '<p>This link expires in 1 hour. If you did not request this, ignore this email.</p>',
      });
    } catch (e) {
      console.error('[forgot-password email]', e.message);
    }

    await audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'password_reset.requested',
      entityType: 'user',
      entityId: user.id,
      ip: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[forgot-password]', err.message);
    res.json({ ok: true });
  }
});

// ---------------------------------------------------------------
// POST /api/auth/reset-password
// ---------------------------------------------------------------
const resetSchema = Joi.object({
  token: Joi.string().length(64).hex().required(),
  password: Joi.string().min(8).max(200).required(),
});

router.post('/reset-password', async (req, res) => {
  try {
    const { error, value } = resetSchema.validate(req.body);
    if (error) return res.status(400).json({ error: 'Invalid input' });

    const hashedToken = crypto.createHash('sha256').update(value.token).digest('hex');

    const [rows] = await db.query(
      'SELECT id, email, role FROM users WHERE reset_token = ? AND reset_expires_at > NOW() LIMIT 1',
      [hashedToken]
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

    await audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'password_reset.completed',
      entityType: 'user',
      entityId: user.id,
      ip: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[reset-password]', err.message);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

// ---------------------------------------------------------------
// GET /api/auth/me — lightweight user info
// ---------------------------------------------------------------
router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

module.exports = router;
