// Append-only audit logger. Never UPDATE or DELETE from this table.
const db = require('../db');

async function log({
  actorUserId = null,
  actorRole = 'system',
  action,
  entityType,
  entityId = null,
  oldValues = null,
  newValues = null,
  ip = null,
  userAgent = null
}) {
  try {
    await db.query(
      `INSERT INTO audit_logs
        (actor_user_id, actor_role, action, entity_type, entity_id,
         old_values, new_values, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorUserId,
        actorRole,
        action,
        entityType,
        entityId,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ip,
        userAgent ? userAgent.substring(0, 255) : null
      ]
    );
  } catch (err) {
    // Audit failures should never crash the app, but must be loud
    console.error('[AUDIT FAILURE]', action, err.message);
  }
}

module.exports = { log };
