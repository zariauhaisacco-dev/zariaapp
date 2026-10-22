const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const db = require('../db');
const audit = require('../services/audit');
const email = require('../services/email');
const emailValidate = require('../services/email-validate');
const ping = require('../services/ping');

const router = express.Router();

// Aggressive rate limit: signup spam kills admin queue
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Try again later.' },
});

// Kenyan phone: 07XXXXXXXX or 01XXXXXXXX (Safaricom/Airtel), optionally +254/254
function normalizeKenyanPhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, '');
  let local = null;
  if (digits.startsWith('254') && digits.length === 12) local = digits.slice(3);
  else if (digits.startsWith('0') && digits.length === 10) local = digits.slice(1);
  else if (digits.length === 9) local = digits;
  if (!local) return null;
  if (!/^[17]\d{8}$/.test(local)) return null;
  return '254' + local;
}

const schema = Joi.object({
  full_name: Joi.string().min(2).max(120).required(),
  email: Joi.string().email().max(255).required(),
  phone: Joi.string().required(),
  national_id: Joi.string().pattern(/^\d{7,8}$/).required()
    .messages({ 'string.pattern.base': 'National ID must be 7 or 8 digits' }),
  password: Joi.string().min(8).max(200).required()
    .messages({ 'string.min': 'Password must be at least 8 characters' }),
  confirm_password: Joi.string().valid(Joi.ref('password')).required()
    .messages({ 'any.only': 'Passwords do not match' }),
  purpose: Joi.string().max(500).allow('', null),
  heard_about: Joi.string().max(50).allow('', null),
  chama_invite_token: Joi.string().max(128).allow('', null),
  // Honeypot: must be empty
  website: Joi.string().max(0).allow('', null).optional(),
});

router.post('/signup', signupLimiter, async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      await audit.log({
        actorRole: 'system',
        action: 'signup.rejected_validation',
        entityType: 'pending_registration',
        newValues: { email: req.body.email, ip },
        ip, userAgent: ua,
      });
      return res.status(400).json({ error: 'Please check the form', details });
    }

    // Honeypot check — bots fill hidden fields
    if (value.website && value.website.length > 0) {
      return res.json({ message: 'Registration received.' }); // pretend success
    }

    const phone = normalizeKenyanPhone(value.phone);
    if (!phone) {
      return res.status(400).json({
        error: 'Invalid phone',
        details: [{ field: 'phone', message: 'Enter a valid Kenyan phone (07XXXXXXXX or 01XXXXXXXX)' }],
      });
    }

    const emailLower = value.email.toLowerCase().trim();

    // Reject email domains that can't receive mail (no MX record).
    // Catches typos like "user@gmial.com" and disposable/nonexistent domains.
    const mxOk = await emailValidate.hasValidMx(emailLower);
    if (!mxOk) {
      await audit.log({
        actorRole: 'system',
        action: 'signup.rejected_email_domain',
        entityType: 'pending_registration',
        newValues: { email: emailLower },
        ip, userAgent: ua,
      });
      return res.status(400).json({
        error: 'That email address cannot receive mail. Please check for typos and try again.',
        details: [{ field: 'email', message: 'This domain does not accept email' }],
      });
    }

    // Duplicate checks — return SAME response shape regardless
    const [dupeUser] = await db.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [emailLower]
    );
    const [dupePending] = await db.query(
      `SELECT id FROM pending_registrations
       WHERE (email = ? OR phone = ? OR national_id = ?)
         AND status = 'pending'
       LIMIT 1`,
      [emailLower, phone, value.national_id]
    );

    if (dupeUser.length || dupePending.length) {
      // Same response as success — do not leak which field collided
      return res.json({
        message: 'Registration received. You will be notified once approved.',
      });
    }

    // Chama invite validation (if present)
    let chamaId = null;
    let chamaInviteId = null;

    if (value.chama_invite_token) {
      const token = value.chama_invite_token.trim();
      const [inviteRows] = await db.query(
        `SELECT ci.id, ci.chama_id, ci.client_id, ci.email, ci.status, ci.expires_at,
                ch.name AS chama_name, ch.status AS chama_status
           FROM chama_invites ci
           JOIN chamas ch ON ch.id = ci.chama_id
          WHERE ci.token = ? LIMIT 1`,
        [token]
      );

      if (!inviteRows.length) {
        return res.status(400).json({
          error: 'This invite link is no longer valid.',
          details: [{ field: 'chama_invite', message: 'Invite not found' }],
        });
      }
      const inv = inviteRows[0];

      if (inv.status !== 'pending') {
        return res.status(409).json({
          error: 'This invite has already been used or declined.',
          details: [{ field: 'chama_invite', message: 'Invite no longer pending' }],
        });
      }
      if (new Date(inv.expires_at).getTime() < Date.now()) {
        return res.status(410).json({
          error: 'This invite has expired. Contact your chama admin.',
          details: [{ field: 'chama_invite', message: 'Invite expired' }],
        });
      }
      if (inv.chama_status !== 'active') {
        return res.status(409).json({
          error: 'The chama is no longer active.',
          details: [{ field: 'chama_invite', message: 'Chama inactive' }],
        });
      }

      // If invite was for a specific email, signup email must match
      if (inv.email && inv.email.toLowerCase().trim() !== emailLower) {
        return res.status(403).json({
          error: 'This invite is for a different email address.',
          details: [{ field: 'chama_invite', message: 'Invite email does not match signup email' }],
        });
      }

      chamaId = inv.chama_id;
      chamaInviteId = inv.id;
    }


    const password_hash = await bcrypt.hash(value.password, 12);

    const [result] = await db.query(
      `INSERT INTO pending_registrations
        (full_name, email, phone, national_id, password_hash, purpose, heard_about,
         chama_id, chama_invite_id, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        value.full_name.trim(),
        emailLower,
        phone,
        value.national_id,
        password_hash,
        value.purpose || null,
        value.heard_about || null,
        chamaId,
        chamaInviteId,
        ip,
        ua.substring(0, 255),
      ]
    );

    await audit.log({
      actorRole: 'system',
      action: 'signup.submitted',
      entityType: 'pending_registration',
      entityId: result.insertId,
      newValues: { email: emailLower, phone },
      ip, userAgent: ua,
    });

    // Notify applicant (best-effort; never fail the request on email errors)
    email.sendSignupReceived(emailLower, value.full_name.trim())
      .catch(e => console.error('[email signup-received]', e.message));

    // Notify admin
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_USER;
    if (adminEmail) {
      email.sendAdminNewSignup(adminEmail, {
        full_name: value.full_name.trim(),
        email: emailLower,
        phone,
        national_id: value.national_id,
      }).catch(e => console.error('[email admin-signup]', e.message));
    }

    // SMS alert to admin
    try {
      const [phoneRow] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'admin_alert_phone'");
      const [enabledRow] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'admin_sms_alerts_enabled'");
      const adminPhone = phoneRow.length ? phoneRow[0].setting_value : '';
      const adminSmsEnabled = !enabledRow.length || enabledRow[0].setting_value === '1';
      if (adminPhone && adminSmsEnabled) {
        ping.sendSms({
          to: adminPhone,
          message: 'ZARIA: New signup — ' + value.full_name.trim() + ' (' + emailLower + '). Review: zariauhai.com/admin/registrations',
          template: 'admin_new_signup',
        }).catch(function (e) { console.error('[signup admin sms]', e.message); });
      }
    } catch (e) { console.error('[signup admin sms]', e.message); }

    res.json({
      message: 'Registration received. You will be notified once approved.',
    });
  } catch (err) {
    console.error('[signup]', err.message);
    res.status(500).json({ error: 'Could not submit registration' });
  }
});

module.exports = router;
module.exports.normalizeKenyanPhone = normalizeKenyanPhone;
