const express = require('express');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');

const router = express.Router();

// List payments, newest first
router.get('/', requireSession, async (req, res) => {
  const { status, studentId, from, to } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const data = await withTenant(req.ctx.tenantId, async (client) => {
    const rows = await client.query(
      `SELECT p.id, p.student_id, s.full_name AS student_name, s.admission_no,
              p.provider, p.provider_ref, p.checkout_request_id,
              p.amount_minor, p.status, p.created_at,
              g.full_name AS paid_by_name, g.msisdn AS paid_by_msisdn,
              p.raw_payload -> 'channel' AS channel
       FROM payments p
       LEFT JOIN students s ON s.id = p.student_id
       LEFT JOIN guardians g ON g.id = p.paid_by_guardian_id
       WHERE ($1::text IS NULL OR p.status = $1)
         AND ($2::uuid IS NULL OR p.student_id = $2)
         AND ($3::timestamptz IS NULL OR p.created_at >= $3)
         AND ($4::timestamptz IS NULL OR p.created_at <= $4)
       ORDER BY p.created_at DESC
       LIMIT $5 OFFSET $6`,
      [status || null, studentId || null, from || null, to || null, limit, offset]
    );

    const count = await client.query(
      `SELECT COUNT(*) AS total FROM payments
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::uuid IS NULL OR student_id = $2)`,
      [status || null, studentId || null]
    );

    return { rows: rows.rows, total: Number(count.rows[0].total) };
  });

  res.json({ data: data.rows, meta: { total: data.total, limit, offset }, error: null });
});

// The orphan queue: money arrived, but we could not match it to a student.
// The money has already left the parent's account, so it is recorded and
// reconciled by hand rather than rejected.
router.get('/unmatched', requireSession, async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `SELECT id, provider, provider_ref, amount_minor, status,
              raw_payload, created_at
       FROM payments
       WHERE student_id IS NULL AND status = 'settled'
       ORDER BY created_at DESC`
    )
  );

  res.json({ data: result.rows, error: null });
});

// Attach an orphan payment to a student
router.patch('/:id/assign', requireSession, async (req, res) => {
  const { studentId } = req.body || {};

  if (!studentId) {
    return res.status(400).json({
      data: null,
      error: { message: 'studentId is required', code: 'BAD_REQUEST' }
    });
  }

  const result = await withTenant(req.ctx.tenantId, async (client) => {
    const payment = await client.query(
      'SELECT id, student_id, amount_minor FROM payments WHERE id = $1',
      [req.params.id]
    );
    if (!payment.rows[0]) return { notFound: 'payment' };
    if (payment.rows[0].student_id) return { alreadyAssigned: true };

    const student = await client.query(
      'SELECT id, full_name FROM students WHERE id = $1 AND deleted_at IS NULL',
      [studentId]
    );
    if (!student.rows[0]) return { notFound: 'student' };

    const updated = await client.query(
      `UPDATE payments SET student_id = $2 WHERE id = $1
       RETURNING id, student_id, amount_minor, status`,
      [req.params.id, studentId]
    );

    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, changes)
       VALUES ($1, $2, 'payment.assigned', 'payment', $3, $4)`,
      [req.ctx.tenantId, req.ctx.userId, req.params.id,
       JSON.stringify({ studentId, studentName: student.rows[0].full_name,
                        amountMinor: payment.rows[0].amount_minor })]
    );

    return { payment: updated.rows[0] };
  });

  if (result.notFound) {
    return res.status(404).json({
      data: null,
      error: { message: `${result.notFound} not found`, code: 'NOT_FOUND' }
    });
  }
  if (result.alreadyAssigned) {
    return res.status(409).json({
      data: null,
      error: { message: 'Payment is already assigned to a student', code: 'ALREADY_ASSIGNED' }
    });
  }

  res.json({ data: result.payment, error: null });
});

module.exports = router;