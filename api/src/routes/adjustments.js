const express = require('express');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

const KINDS = ['waiver', 'bursary', 'reversal', 'correction'];

// Anyone signed in can read the history
router.get('/', requireSession, async (req, res) => {
  const { studentId, kind } = req.query;

  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `SELECT a.id, a.student_id, s.full_name AS student_name, s.admission_no,
              a.kind, a.amount_minor, a.reason, a.created_at,
              u.email AS actor_email
       FROM adjustments a
       JOIN students s ON s.id = a.student_id
       JOIN users u ON u.id = a.actor_user_id
       WHERE ($1::uuid IS NULL OR a.student_id = $1)
         AND ($2::text IS NULL OR a.kind = $2)
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [studentId || null, kind || null]
    )
  );

  res.json({ data: result.rows, error: null });
});

// Only a manager can change what a student owes
router.post('/', requireSession, requireRole('manager'), async (req, res) => {
  const { studentId, kind, amountMinor, reason } = req.body || {};

  if (!studentId || !kind || !reason) {
    return res.status(400).json({
      data: null,
      error: { message: 'studentId, kind and reason are required', code: 'BAD_REQUEST' }
    });
  }

  if (!KINDS.includes(kind)) {
    return res.status(422).json({
      data: null,
      error: { message: `kind must be one of: ${KINDS.join(', ')}`, code: 'INVALID_KIND' }
    });
  }

  if (!Number.isInteger(amountMinor) || amountMinor === 0) {
    return res.status(400).json({
      data: null,
      error: { message: 'amountMinor must be a non-zero integer', code: 'BAD_AMOUNT' }
    });
  }

  if (reason.trim().length < 5) {
    return res.status(422).json({
      data: null,
      error: { message: 'reason must be meaningful', code: 'REASON_TOO_SHORT' }
    });
  }

  const result = await withTenant(req.ctx.tenantId, async (client) => {
    const student = await client.query(
      'SELECT id, full_name FROM students WHERE id = $1 AND deleted_at IS NULL',
      [studentId]
    );
    if (!student.rows[0]) return { notFound: true };

    const adjustment = await client.query(
      `INSERT INTO adjustments (tenant_id, student_id, kind, amount_minor,
                                reason, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, student_id, kind, amount_minor, reason, created_at`,
      [req.ctx.tenantId, studentId, kind, amountMinor, reason.trim(), req.ctx.userId]
    );

    // Same transaction — if the audit row fails, the adjustment rolls back
    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, changes)
       VALUES ($1, $2, $3, 'student', $4, $5)`,
      [
        req.ctx.tenantId,
        req.ctx.userId,
        `adjustment.${kind}`,
        studentId,
        JSON.stringify({ amountMinor, reason: reason.trim(),
                         studentName: student.rows[0].full_name }),
      ]
    );

    return { adjustment: adjustment.rows[0] };
  });

  if (result.notFound) {
    return res.status(404).json({
      data: null,
      error: { message: 'Student not found', code: 'NOT_FOUND' }
    });
  }

  res.status(201).json({ data: result.adjustment, error: null });
});

module.exports = router;