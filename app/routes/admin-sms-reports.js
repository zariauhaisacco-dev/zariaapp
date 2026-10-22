const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// GET /api/admin/reports/sms
router.get('/', async (req, res) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const status = req.query.status || null;
    const q = (req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 50;

    const where = [];
    const params = [];

    if (from) { where.push('sl.created_at >= ?'); params.push(from + ' 00:00:00'); }
    if (to)   { where.push('sl.created_at <= ?'); params.push(to + ' 23:59:59'); }
    if (status && ['pending','sent','delivered','failed'].includes(status)) {
      where.push('sl.status = ?'); params.push(status);
    }
    if (q) {
      where.push('(sl.phone LIKE ? OR sl.message LIKE ? OR sl.template LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like, like);
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM sms_logs sl ${whereSql}`,
      params
    );
    const total = countRows[0].total;
    const pages = Math.max(1, Math.ceil(total / perPage));

    const [rows] = await db.query(
      `SELECT sl.id, sl.client_id, c.full_name AS client_name, sl.phone,
              sl.message, sl.template, sl.status, sl.provider_message_id,
              sl.credits_charged, sl.parts, sl.error_message,
              sl.created_at, sl.delivered_at
         FROM sms_logs sl
         LEFT JOIN clients c ON c.id = sl.client_id
         ${whereSql}
         ORDER BY sl.id DESC
         LIMIT ? OFFSET ?`,
      params.concat([perPage, (page - 1) * perPage])
    );

    const [summaryRows] = await db.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN sl.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN sl.status = 'sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN sl.status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN sl.status = 'pending' THEN 1 ELSE 0 END) AS pending,
         COALESCE(SUM(sl.credits_charged), 0) AS total_credits,
         COALESCE(SUM(sl.parts), 0) AS total_parts
       FROM sms_logs sl ${whereSql}`,
      params
    );

    res.json({
      sms: rows,
      summary: summaryRows[0],
      pagination: { page, pages, total, per_page: perPage },
    });
  } catch (err) {
    console.error('[sms reports]', err.message);
    res.status(500).json({ error: 'Could not load SMS reports' });
  }
});

// GET /api/admin/reports/sms/export.csv
router.get('/export.csv', async (req, res) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const status = req.query.status || null;
    const q = (req.query.q || '').trim();

    const where = [];
    const params = [];
    if (from) { where.push('sl.created_at >= ?'); params.push(from + ' 00:00:00'); }
    if (to)   { where.push('sl.created_at <= ?'); params.push(to + ' 23:59:59'); }
    if (status && ['pending','sent','delivered','failed'].includes(status)) {
      where.push('sl.status = ?'); params.push(status);
    }
    if (q) {
      where.push('(sl.phone LIKE ? OR sl.message LIKE ? OR sl.template LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT sl.id, sl.client_id, c.full_name AS client_name, sl.phone,
              sl.template, sl.status, sl.parts, sl.credits_charged,
              sl.provider_message_id, sl.transaction_reference,
              sl.error_message, sl.created_at, sl.delivered_at,
              sl.message
         FROM sms_logs sl
         LEFT JOIN clients c ON c.id = sl.client_id
         ${whereSql}
         ORDER BY sl.id DESC
         LIMIT 10000`,
      params
    );

    function esc(s) {
      if (s == null) return '';
      return '"' + String(s).replace(/"/g, '""') + '"';
    }
    const header = 'ID,Date,Phone,Client,Template,Status,Parts,Credits,ProviderID,TxRef,DeliveredAt,ErrorMessage,Message';
    const lines = rows.map(function (r) {
      return [
        r.id, r.created_at ? r.created_at.toISOString() : '', r.phone, r.client_name || '',
        r.template || '', r.status, r.parts, r.credits_charged || '',
        r.provider_message_id || '', r.transaction_reference || '',
        r.delivered_at ? r.delivered_at.toISOString() : '', r.error_message || '',
        (r.message || '').replace(/\n/g, ' ')
      ].map(esc).join(',');
    }).join('\n');

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="zaria-sms-log-' + dateStr + '.csv"');
    res.send(header + '\n' + lines + '\n');
  } catch (err) {
    console.error('[sms reports csv]', err.message);
    res.status(500).json({ error: 'Could not export SMS log' });
  }
});

module.exports = router;
