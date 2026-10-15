const db = require('../db');

// Loads the user and verifies the session is still valid
async function authenticate(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated', code: 'no_session' });
    }

    const [rows] = await db.query(
      'SELECT id, email, role, current_session_id FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (!rows.length) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'User not found', code: 'user_missing' });
    }

    const user = rows[0];

    // Single-session enforcement for admins
    if (user.role === 'admin') {
      if (!user.current_session_id || user.current_session_id !== req.session.sessionId) {
        req.session.destroy(() => {});
        return res.status(401).json({
          error: 'Your session ended because this account signed in elsewhere.',
          code: 'session_replaced',
        });
      }
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[auth]', err.message);
    return res.status(500).json({ error: 'Auth error' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role !== role) {
      console.warn('[role_mismatch]', {
        userId: req.user.id,
        actual: req.user.role,
        required: role,
        path: req.path,
        ip: req.ip,
      });
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
