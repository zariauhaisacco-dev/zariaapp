const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// ===============================================================
// GET /api/admin/audit
// Query params:
//   page=1 (default), per_page=50 (max 200)
//   q=<text search in action or email>
//   action=<exact action filter>
//   actor_role=admin|client|system
//   actor_user_id=<number>
//   entity_type=<string>
//   entity_id=<number>
//   from=YYYY-MM-DD, to=YYYY-MM-DD
//   ip=<partial IP>
// ===============================================================
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page, 10) || 50));
    const offset = (page - 1) * perPage;

    const where = [];
    const params = [];

    if (req.query.q) {
      where.push('(al.action LIKE ? OR u.email LIKE ?)');
      params.push('%' + req.query.q + '%', '%' + req.query.q + '%');
    }
    if (req.query.action) {
      where.push('al.action = ?');
      params.push(req.query.action);
    }
    if (req.query.actor_role) {
      where.push('al.actor_role = ?');
      params.push(req.query.actor_role);
    }
    if (req.query.actor_user_id) {
      where.push('al.actor_user_id = ?');
      params.push(parseInt(req.query.actor_user_id, 10));
    }
    if (req.query.entity_type) {
      where.push('al.entity_type = ?');
      params.push(req.query.entity_type);
    }
    if (req.query.entity_id) {
      where.push('al.entity_id = ?');
      params.push(parseInt(req.query.entity_id, 10));
    }
    if (req.query.from) {
      where.push('al.created_at >= ?');
      params.push(req.query.from + ' 00:00:00');
    }
    if (req.query.to) {
      where.push('al.created_at <= ?');
      params.push(req.query.to + ' 23:59:59');
    }
    if (req.query.ip) {
      where.push('al.ip_address LIKE ?');
      params.push('%' + req.query.ip + '%');
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Count total for pagination
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
         ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    // Fetch page
    const [rows] = await db.query(
      `SELECT al.id, al.actor_user_id, al.actor_role, al.action,
              al.entity_type, al.entity_id,
              al.old_values, al.new_values,
              al.ip_address, al.user_agent, al.created_at,
              u.email AS actor_email
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
         ${whereSql}
         ORDER BY al.id DESC
         LIMIT ? OFFSET ?`,
      params.concat([perPage, offset])
    );

    res.json({
      total,
      page,
      per_page: perPage,
      pages: Math.ceil(total / perPage),
      events: rows,
    });
  } catch (err) {
    console.error('[audit list]', err.message);
    res.status(500).json({ error: 'Could not load audit log' });
  }
});

// ===============================================================
// GET /api/admin/audit/actions — distinct action names (for filter dropdown)
// ===============================================================
router.get('/actions', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT action FROM audit_logs ORDER BY action ASC`
    );
    res.json({ actions: rows.map(r => r.action) });
  } catch (err) {
    console.error('[audit actions]', err.message);
    res.status(500).json({ error: 'Could not load actions' });
  }
});

// ===============================================================
// GET /api/admin/audit/export.csv
// Same filters as list, no pagination. Capped at 50,000 rows.
// ===============================================================
router.get('/export.csv', async (req, res) => {
  try {
    const where = [];
    const params = [];

    if (req.query.q) {
      where.push('(al.action LIKE ? OR u.email LIKE ?)');
      params.push('%' + req.query.q + '%', '%' + req.query.q + '%');
    }
    if (req.query.action) { where.push('al.action = ?'); params.push(req.query.action); }
    if (req.query.actor_role) { where.push('al.actor_role = ?'); params.push(req.query.actor_role); }
    if (req.query.actor_user_id) { where.push('al.actor_user_id = ?'); params.push(parseInt(req.query.actor_user_id, 10)); }
    if (req.query.entity_type) { where.push('al.entity_type = ?'); params.push(req.query.entity_type); }
    if (req.query.entity_id) { where.push('al.entity_id = ?'); params.push(parseInt(req.query.entity_id, 10)); }
    if (req.query.from) { where.push('al.created_at >= ?'); params.push(req.query.from + ' 00:00:00'); }
    if (req.query.to) { where.push('al.created_at <= ?'); params.push(req.query.to + ' 23:59:59'); }
    if (req.query.ip) { where.push('al.ip_address LIKE ?'); params.push('%' + req.query.ip + '%'); }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT al.id, al.created_at, al.actor_user_id, u.email AS actor_email,
              al.actor_role, al.action, al.entity_type, al.entity_id,
              al.old_values, al.new_values, al.ip_address, al.user_agent
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
         ${whereSql}
         ORDER BY al.id DESC
         LIMIT 50000`,
      params
    );

    const header = ['ID', 'Timestamp', 'Actor ID', 'Actor Email', 'Role', 'Action',
                    'Entity Type', 'Entity ID', 'IP', 'User Agent', 'Old Values', 'New Values'];
    function csvEscape(v) {
      if (v == null) return '';
      var s = String(v);
      if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }
    const lines = [header.join(',')];
    rows.forEach(function (r) {
      lines.push([
        r.id,
        r.created_at ? r.created_at.toISOString() : '',
        r.actor_user_id,
        r.actor_email,
        r.actor_role,
        r.action,
        r.entity_type,
        r.entity_id,
        r.ip_address,
        r.user_agent,
        r.old_values ? JSON.stringify(r.old_values) : '',
        r.new_values ? JSON.stringify(r.new_values) : '',
      ].map(csvEscape).join(','));
    });

    const from = req.query.from || 'all';
    const to = req.query.to || 'all';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      'attachment; filename="zaria-audit-' + from + '-to-' + to + '.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[audit csv]', err.message);
    res.status(500).send('Could not export');
  }
});

module.exports = router;
