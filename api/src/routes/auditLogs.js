const express = require('express');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

// Manager only — the log records who spent the school's money, and that
// is not something every member of staff should be browsing.
router.get('/', requireSession, requireRole('manager'), async (req, res) => {
  const { action, targetId, from, to } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const data = await withTenant(req.ctx.tenantId, async (client) => {
    const rows = await client.query(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.changes, a.created_at,
              u.email AS actor_email, u.role AS actor_role
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ($1::text IS NULL OR a.action = $1)
         AND ($2::uuid IS NULL OR a.target_id = $2)
         AND ($3::timestamptz IS NULL OR a.created_at >= $3)
         AND ($4::timestamptz IS NULL OR a.created_at <= $4)
       ORDER BY a.created_at DESC
       LIMIT $5 OFFSET $6`,
      [action || null, targetId || null, from || null, to || null, limit, offset]
    );

    const count = await client.query(
      `SELECT COUNT(*) AS total FROM audit_log
       WHERE ($1::text IS NULL OR action = $1)
         AND ($2::uuid IS NULL OR target_id = $2)`,
      [action || null, targetId || null]
    );

    return { rows: rows.rows, total: Number(count.rows[0].total) };
  });

  res.json({
    data: data.rows,
    meta: { total: data.total, limit, offset },
    error: null,
  });
});

module.exports = router;