const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const db = require('../db');
const audit = require('../services/audit');
const email = require('../services/email');
const notify = require('../services/notify');
const savings = require('../services/savings');
const chama = require('../services/chama');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ---- GET list ----
router.get('/', async (req, res) => {
  const status = req.query.status || 'pending';
  const allowed = ['pending', 'approved', 'rejected', 'expired', 'all'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const where = status === 'all' ? '' : 'WHERE pr.status = ?';
  const params = status === 'all' ? [] : [status];

  const [rows] = await db.query(
    `SELECT pr.id, pr.full_name, pr.email, pr.phone, pr.national_id, pr.purpose, pr.heard_about,
            pr.status, pr.rejection_reason, pr.reviewed_by, pr.reviewed_at,
            pr.created_user_id, pr.ip_address, pr.created_at, pr.expires_at,
            pr.chama_id, pr.chama_invite_id,
            ch.name AS chama_name, ch.code AS chama_code
       FROM pending_registrations pr
       LEFT JOIN chamas ch ON ch.id = pr.chama_id
       ${where}
       ORDER BY pr.created_at DESC
       LIMIT 200`,
    params
  );

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

// ---- GET single ----
router.get('/:id', async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM pending_registrations WHERE id = ? LIMIT 1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const row = rows[0];
  const [dupes] = await db.query(
    `SELECT c.id, c.full_name, c.phone FROM clients c
      WHERE c.phone = ? OR c.national_id = ? LIMIT 5`,
    [row.phone, row.national_id]
  );
  res.json({ registration: { ...row, duplicates: dupes } });
});

// ---- NEW: GET candidates for a pending registration ----
// Matches against historic clients only (users.email LIKE 'member-%@zaria.local')
router.get('/:id/candidates', async (req, res) => {
  try {
    const [prRows] = await db.query(
      'SELECT id, full_name, email, phone, national_id FROM pending_registrations WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    if (!prRows.length) return res.status(404).json({ error: 'Registration not found' });
    const p = prRows[0];

    const matches = [];
    const seenIds = new Set();

    // Match 1: national_id exact
    if (p.national_id) {
      const [rows] = await db.query(
        `SELECT c.id AS client_id, c.full_name, c.phone, c.national_id,
                u.email AS historic_email,
                (SELECT balance FROM savings_accounts WHERE client_id = c.id LIMIT 1) AS savings_balance,
                (SELECT shares_held FROM share_holdings WHERE client_id = c.id LIMIT 1) AS shares_held
           FROM clients c JOIN users u ON u.id = c.user_id
          WHERE u.email LIKE 'member-%@zaria.local'
            AND c.national_id = ?
          LIMIT 5`,
        [p.national_id]
      );
      rows.forEach(r => { if (!seenIds.has(r.client_id)) { matches.push({ ...r, match_type: 'national_id', confidence: 'high' }); seenIds.add(r.client_id); } });
    }

    // Match 2: phone exact (only if not already matched)
    if (p.phone) {
      const [rows] = await db.query(
        `SELECT c.id AS client_id, c.full_name, c.phone, c.national_id,
                u.email AS historic_email,
                (SELECT balance FROM savings_accounts WHERE client_id = c.id LIMIT 1) AS savings_balance,
                (SELECT shares_held FROM share_holdings WHERE client_id = c.id LIMIT 1) AS shares_held
           FROM clients c JOIN users u ON u.id = c.user_id
          WHERE u.email LIKE 'member-%@zaria.local'
            AND c.phone = ?
          LIMIT 5`,
        [p.phone]
      );
      rows.forEach(r => { if (!seenIds.has(r.client_id)) { matches.push({ ...r, match_type: 'phone', confidence: 'high' }); seenIds.add(r.client_id); } });
    }

    // Match 3: full_name exact (case-insensitive)
    if (p.full_name) {
      const [rows] = await db.query(
        `SELECT c.id AS client_id, c.full_name, c.phone, c.national_id,
                u.email AS historic_email,
                (SELECT balance FROM savings_accounts WHERE client_id = c.id LIMIT 1) AS savings_balance,
                (SELECT shares_held FROM share_holdings WHERE client_id = c.id LIMIT 1) AS shares_held
           FROM clients c JOIN users u ON u.id = c.user_id
          WHERE u.email LIKE 'member-%@zaria.local'
            AND LOWER(c.full_name) = LOWER(?)
          LIMIT 5`,
        [p.full_name]
      );
      rows.forEach(r => { if (!seenIds.has(r.client_id)) { matches.push({ ...r, match_type: 'full_name', confidence: 'medium' }); seenIds.add(r.client_id); } });
    }

    res.json({ registration: p, candidates: matches });
  } catch (err) {
    console.error('[candidates]', err.message);
    res.status(500).json({ error: 'Could not load candidates' });
  }
});

// ---- NEW: search historic clients ----
router.get('/historic/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ clients: [] });

    const like = '%' + q + '%';
    const [rows] = await db.query(
      `SELECT c.id AS client_id, c.full_name, c.phone, c.national_id,
              u.email AS historic_email,
              (SELECT balance FROM savings_accounts WHERE client_id = c.id LIMIT 1) AS savings_balance,
              (SELECT shares_held FROM share_holdings WHERE client_id = c.id LIMIT 1) AS shares_held
         FROM clients c JOIN users u ON u.id = c.user_id
        WHERE u.email LIKE 'member-%@zaria.local'
          AND (c.full_name LIKE ? OR c.phone LIKE ? OR c.national_id LIKE ?)
        ORDER BY c.full_name
        LIMIT 20`,
      [like, like, like]
    );
    res.json({ clients: rows });
  } catch (err) {
    console.error('[historic search]', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ---- NEW: merge a pending registration with an existing historic client ----
router.post('/:id/merge', async (req, res) => {
  const clientId = Number(req.body.client_id);
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const conn = await db.getConnection();
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    await conn.beginTransaction();

    // Lock pending registration
    const [prRows] = await conn.query(
      `SELECT * FROM pending_registrations WHERE id = ? AND status = 'pending' FOR UPDATE`,
      [req.params.id]
    );
    if (!prRows.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Not pending or already processed' });
    }
    const pending = prRows[0];

    // Lock historic client + user
    const [histRows] = await conn.query(
      `SELECT c.id AS client_id, c.user_id, c.full_name, c.phone, c.national_id, c.chama_id AS client_chama_id,
              u.email AS historic_email, u.id AS user_id
         FROM clients c JOIN users u ON u.id = c.user_id
        WHERE c.id = ? AND u.email LIKE 'member-%@zaria.local'
        FOR UPDATE`,
      [clientId]
    );
    if (!histRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Historic client not found or not mergeable' });
    }
    const hist = histRows[0];

    // Ensure new email is not taken by another user
    const [emailClash] = await conn.query(
      'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1',
      [pending.email, hist.user_id]
    );
    if (emailClash.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Email already in use by another user' });
    }

    // Update the historic user: email, password, must_change_password
    await conn.query(
      `UPDATE users SET email = ?, password_hash = ?, must_change_password = 0 WHERE id = ?`,
      [pending.email, pending.password_hash, hist.user_id]
    );

    // Update historic client: phone (signup wins), fill national_id if blank
    await conn.query(
      `UPDATE clients SET phone = ?, national_id = COALESCE(national_id, ?), status = 'active', updated_at = NOW() WHERE id = ?`,
      [pending.phone, pending.national_id || null, hist.client_id]
    );

    // Chama enrollment if pending has chama_id
    let chamaEnrolled = false;
    if (pending.chama_id) {
      await conn.query(
        'UPDATE clients SET chama_id = ? WHERE id = ?',
        [pending.chama_id, hist.client_id]
      );
      const period = chama.currentPeriod();
      const [cfg] = await conn.query(
        'SELECT monthly_contribution_min FROM chamas WHERE id = ? LIMIT 1',
        [pending.chama_id]
      );
      if (cfg.length) {
        await conn.query(
          `INSERT INTO chama_contributions
             (chama_id, client_id, period, amount_due, amount_paid, status)
           VALUES (?, ?, ?, ?, 0, 'pending')
           ON DUPLICATE KEY UPDATE amount_due = VALUES(amount_due)`,
          [pending.chama_id, hist.client_id, period, cfg[0].monthly_contribution_min]
        );
      }
      if (pending.chama_invite_id) {
        await conn.query(
          `UPDATE chama_invites SET status = 'accepted', responded_at = NOW() WHERE id = ?`,
          [pending.chama_invite_id]
        );
      }
      chamaEnrolled = true;
    }

    // Mark pending registration approved, pointing at existing user
    await conn.query(
      `UPDATE pending_registrations
          SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), created_user_id = ?
        WHERE id = ?`,
      [req.user.id, hist.user_id, req.params.id]
    );

    await conn.commit();

    // Audit log after commit (best-effort)
    try {
      await audit.log({
        actorUserId: req.user.id,
        actorRole: 'admin',
        action: 'registration.merged_with_historic',
        entityType: 'client',
        entityId: hist.client_id,
        oldValues: { email: hist.historic_email, phone: hist.phone, national_id: hist.national_id },
        newValues: { email: pending.email, phone: pending.phone, national_id: pending.national_id || hist.national_id },
        ip, userAgent: ua,
      });
    } catch (e) { console.error('[merge audit]', e.message); }

    // Welcome email (best-effort)
    notify.alert({
      template: 'account_approved',
      clientId: hist.client_id,
      data: { fullName: pending.full_name, email: pending.email },
    }).catch(e => console.error('[merge welcome]', e.message));

    res.json({
      ok: true,
      merged_client_id: hist.client_id,
      user_id: hist.user_id,
      historic_email_before: hist.historic_email,
      new_email: pending.email,
      chamaEnrolled,
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[merge]', err.message);
    res.status(500).json({ error: 'Merge failed' });
  } finally {
    conn.release();
  }
});

// ---- Approve (existing, unchanged) ----
router.post('/:id/approve', async (req, res) => {
  const conn = await db.getConnection();
  const ip = req.ip;
  const ua = req.get('user-agent') || '';

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM pending_registrations WHERE id = ? AND status = 'pending' FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Not pending or already processed' });
    }
    const pending = rows[0];

    const [existing] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [pending.email]);
    if (existing.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Email already registered' });
    }

    const [userResult] = await conn.query(
      `INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, 'client', 0)`,
      [pending.email, pending.password_hash]
    );
    const userId = userResult.insertId;

    const [clientResult] = await conn.query(
      `INSERT INTO clients (user_id, full_name, phone, national_id, status, created_by)
       VALUES (?, ?, ?, ?, 'active', ?)`,
      [userId, pending.full_name, pending.phone, pending.national_id, req.user.id]
    );

    let chamaEnrolled = false;
    let chamaId = null;
    if (pending.chama_id) {
      await conn.query('UPDATE clients SET chama_id = ? WHERE id = ?', [pending.chama_id, clientResult.insertId]);
      const period = chama.currentPeriod();
      const [chamaCfgRows] = await conn.query('SELECT monthly_contribution_min FROM chamas WHERE id = ? LIMIT 1', [pending.chama_id]);
      if (chamaCfgRows.length) {
        await conn.query(
          `INSERT INTO chama_contributions
             (chama_id, client_id, period, amount_due, amount_paid, status)
           VALUES (?, ?, ?, ?, 0, 'pending')
           ON DUPLICATE KEY UPDATE amount_due = VALUES(amount_due)`,
          [pending.chama_id, clientResult.insertId, period, chamaCfgRows[0].monthly_contribution_min]
        );
      }
      chamaEnrolled = true;
      chamaId = pending.chama_id;
      if (pending.chama_invite_id) {
        await conn.query("UPDATE chama_invites SET status='accepted', responded_at=NOW() WHERE id = ?", [pending.chama_invite_id]);
      }
    }

    await conn.query(
      `UPDATE pending_registrations SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), created_user_id = ? WHERE id = ?`,
      [req.user.id, userId, req.params.id]
    );

    await conn.commit();

    let savingsAccountId = null;
    try {
      savingsAccountId = await savings.createAccountForClient(clientResult.insertId);
    } catch (err) { console.error('[approve] Auto-open savings failed:', err.message); }

    await audit.log({
      actorUserId: req.user.id, actorRole: 'admin',
      action: 'registration.approved',
      entityType: 'user', entityId: userId,
      newValues: { email: pending.email, client_id: clientResult.insertId, savings_account_id: savingsAccountId },
      ip, userAgent: ua,
    });

    notify.alert({
      template: 'account_approved', clientId: clientResult.insertId,
      data: { fullName: pending.full_name, email: pending.email },
    }).catch(e => console.error('[notify approval]', e.message));

    try {
      const [feeEnabledRows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key='registration_fee_enabled'");
      const feeEnabled = feeEnabledRows.length && feeEnabledRows[0].setting_value === '1';
      if (feeEnabled) {
        const [feeAmountRows] = await db.query('SELECT registration_fee_amount FROM clients WHERE id = ?', [clientResult.insertId]);
        const feeAmount = feeAmountRows.length ? Number(feeAmountRows[0].registration_fee_amount) : 0;
        if (feeAmount > 0) {
          notify.alert({
            template: 'registration_fee_due', clientId: clientResult.insertId, data: { amount: feeAmount },
          }).catch(function (e) { console.error('[notify reg fee due]', e.message); });
        }
      }
    } catch (e) { console.error('[notify fee due]', e.message); }

    res.json({ ok: true, userId, clientId: clientResult.insertId, savingsAccountId, chamaId, chamaEnrolled });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[approve]', err.message);
    res.status(500).json({ error: 'Approval failed' });
  } finally {
    conn.release();
  }
});

// ---- Reject (existing, unchanged) ----
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
      `SELECT * FROM pending_registrations WHERE id = ? AND status = 'pending' LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(409).json({ error: 'Not pending or already processed' });
    const pending = rows[0];

    await db.query(
      `UPDATE pending_registrations SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [value.reason, req.user.id, req.params.id]
    );

    if (pending.chama_invite_id) {
      await db.query("UPDATE chama_invites SET status='declined', responded_at=NOW() WHERE id = ?", [pending.chama_invite_id]);
    }

    await audit.log({
      actorUserId: req.user.id, actorRole: 'admin',
      action: 'registration.rejected',
      entityType: 'pending_registration', entityId: pending.id,
      newValues: { email: pending.email, reason: value.reason },
      ip, userAgent: ua,
    });

    notify.alert({
      template: 'account_rejected',
      data: { fullName: pending.full_name, email: pending.email, reason: value.sendReason ? value.reason : null },
    }).catch(e => console.error('[notify rejection]', e.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('[reject]', err.message);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

module.exports = router;
