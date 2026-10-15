const express = require('express');
const Joi = require('joi');
const db = require('../db');
const audit = require('../services/audit');
const email = require('../services/email');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requireRole('admin'));

// --- GET list (with optional status filter) ---
router.get('/', async (req, res) => {
  const status = req.query.status || 'pending';
  const allowed = ['pending', 'approved', 'rejected', 'expired', 'all'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const where = status === 'all' ? '' : 'WHERE status = ?';
  const params = status === 'all' ? [] : [status];

  const [rows] = await db.query(
    `SELECT id, full_name, email, phone, national_id, purpose, heard_about,
            status, rejection_reason, reviewed_by, reviewed_at,
            created_user_id, ip_address, created_at, expires_at
       FROM pending_registrations
       ${where}
       ORDER BY created_at DESC
       LIMIT 200`,
    params
  );

  // For each row, check for suspected duplicates in clients/users
  const enriched = await Promise.all(rows.map(async (r) => {
    const [dupes] = await db.query(
      `SELECT c.id, c.full_name, c.phone
         FROM clients c
        WHERE c.phone = ? OR c.national_id = ?
        LIMIT 5`,
      [r.phone, r.national_id]
    );
    return { ...r, duplicates: dupes };
  }));

  res.json({ registrations: enriched });
});

// --- GET single ---
router.get('/:id', async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM pending_registrations WHERE id = ? LIMIT 1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const row = rows[0];
  const [dupes] = await db.query(
    `SELECT c.id, c.full_name, c.phone
       FROM clients c
      WHERE c.phone = ? OR c.national_id = ?
      LIMIT 5`,
    [row.phone, row.national_id]
  );
  res.json({ registration: { ...row, duplicates: dupes } });
});

// --- Approve ---
router.post('/:id/approve', async (req, res) => {
  const conn = await db.getConnection();
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    await conn.beginTransaction();

    // Lock the row to prevent double-approval
    const [rows] = await conn.query(
      `SELECT * FROM pending_registrations
        WHERE id = ? AND status = 'pending' FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Not pending or already processed' });
    }
    const pending = rows[0];

    // Re-check email uniqueness
    const [existing] = await conn.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [pending.email]
    );
    if (existing.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create user
    const [userResult] = await conn.query(
      `INSERT INTO users (email, password_hash, role, must_change_password)
       VALUES (?, ?, 'client', 0)`,
      [pending.email, pending.password_hash]
    );
    const userId = userResult.insertId;

    // Create client
    const [clientResult] = await conn.query(
      `INSERT INTO clients (user_id, full_name, phone, national_id, status, created_by)
       VALUES (?, ?, ?, ?, 'active', ?)`,
      [userId, pending.full_name, pending.phone, pending.national_id, req.user.id]
    );

    // Mark approved
    await conn.query(
      `UPDATE pending_registrations
          SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), created_user_id = ?
        WHERE id = ?`,
      [req.user.id, userId, req.params.id]
    );

    await conn.commit();

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'registration.approved',
      entityType: 'user',
      entityId: userId,
      newValues: { email: pending.email, client_id: clientResult.insertId },
      ip, userAgent: ua,
    });

    // Send approval email (best-effort)
    email.sendApproval({
      full_name: pending.full_name,
      email: pending.email,
    }).catch(e => console.error('[email approval]', e.message));

    res.json({
      ok: true,
      userId,
      clientId: clientResult.insertId,
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[approve]', err.message);
    res.status(500).json({ error: 'Approval failed' });
  } finally {
    conn.release();
  }
});

// --- Reject ---
const rejectSchema = Joi.object({
  reason: Joi.string().min(3).max(500).required(),
  sendReason: Joi.boolean().default(true),
});

router.post('/:id/reject', async (req, res) => {
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    const { error, value } = rejectSchema.validate(req.body);
    if (error) return res.status(400).json({ error: 'Invalid input' });

    const [rows] = await db.query(
      `SELECT * FROM pending_registrations
        WHERE id = ? AND status = 'pending' LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(409).json({ error: 'Not pending or already processed' });
    }
    const pending = rows[0];

    await db.query(
      `UPDATE pending_registrations
          SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW()
        WHERE id = ?`,
      [value.reason, req.user.id, req.params.id]
    );

    await audit.log({
      actorUserId: req.user.id,
      actorRole: 'admin',
      action: 'registration.rejected',
      entityType: 'pending_registration',
      entityId: pending.id,
      newValues: { email: pending.email, reason: value.reason },
      ip, userAgent: ua,
    });

    email.sendRejection(
      { full_name: pending.full_name, email: pending.email },
      value.sendReason ? value.reason : null
    ).catch(e => console.error('[email rejection]', e.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('[reject]', err.message);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

module.exports = router;
