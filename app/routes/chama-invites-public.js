/*
 * Zaria — Chama invites (public preview)
 *
 * GET /api/chama-invites/:token/preview — public, no auth.
 * Returns chama name + code + masked email for a valid invite token.
 * Used by the signup page to show "You're joining X" banner.
 */

const express = require('express');
const db = require('../db');

const router = express.Router();

function maskEmail(email) {
  if (!email) return null;
  const parts = String(email).split('@');
  if (parts.length !== 2) return null;
  const local = parts[0];
  const domain = parts[1];
  if (local.length <= 2) return '*'.repeat(local.length) + '@' + domain;
  const visible = local.substring(0, Math.min(2, local.length - 1));
  const masked = visible + '*'.repeat(Math.max(2, local.length - visible.length));
  return masked + '@' + domain;
}

router.get('/:token/preview', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 20 || token.length > 128) {
      return res.status(400).json({ valid: false, reason: 'not_found' });
    }

    const [rows] = await db.query(
      `SELECT ci.id, ci.chama_id, ci.client_id, ci.email, ci.status,
              ci.expires_at, ci.created_at,
              ch.name AS chama_name, ch.code AS chama_code, ch.status AS chama_status,
              u.email AS inviter_email
         FROM chama_invites ci
         JOIN chamas ch ON ch.id = ci.chama_id
         LEFT JOIN users u ON u.id = ci.invited_by
        WHERE ci.token = ? LIMIT 1`,
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ valid: false, reason: 'not_found' });
    }

    const inv = rows[0];

    if (inv.status === 'accepted') return res.json({ valid: false, reason: 'already_used' });
    if (inv.status === 'declined') return res.json({ valid: false, reason: 'declined' });
    if (inv.status === 'expired') return res.json({ valid: false, reason: 'cancelled' });

    const expiresAt = new Date(inv.expires_at);
    if (expiresAt.getTime() < Date.now()) {
      return res.json({ valid: false, reason: 'expired' });
    }

    if (inv.chama_status === 'inactive') {
      return res.json({ valid: false, reason: 'chama_inactive' });
    }

    res.json({
      valid: true,
      chama_name: inv.chama_name,
      chama_code: inv.chama_code,
      inviter_email: inv.inviter_email,
      expires_at: inv.expires_at,
      client_email_masked: maskEmail(inv.email),
    });
  } catch (err) {
    console.error('[chama-invites-preview]', err.message);
    res.status(500).json({ valid: false, reason: 'server_error' });
  }
});

module.exports = router;
