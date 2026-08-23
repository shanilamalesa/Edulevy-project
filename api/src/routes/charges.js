const express = require('express');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');

const router = express.Router();

router.post('/', requireSession, async (req, res) => {
  const { studentId, feeItemId } = req.body || {};

  if (!studentId || !feeItemId) {
    return res.status(400).json({
      data: null,
      error: { message: 'studentId and feeItemId are required', code: 'BAD_REQUEST' }
    });
  }

  const result = await withTenant(req.ctx.tenantId, async (client) => {
    // amount comes from the fee item, never from the request body
    const fee = await client.query(
      'SELECT id, amount_minor, active FROM fee_items WHERE id = $1',
      [feeItemId]
    );
    if (!fee.rows[0]) return { notFound: 'fee item' };
    if (!fee.rows[0].active) return { inactive: true };

    const student = await client.query('SELECT id FROM students WHERE id = $1', [studentId]);
    if (!student.rows[0]) return { notFound: 'student' };

    const charge = await client.query(
      `INSERT INTO charges (tenant_id, student_id, fee_item_id, amount_minor)
       VALUES ($1, $2, $3, $4)
       RETURNING id, student_id, fee_item_id, amount_minor, created_at`,
      [req.ctx.tenantId, studentId, feeItemId, fee.rows[0].amount_minor]
    );
    return { charge: charge.rows[0] };
  });

  if (result.notFound) {
    return res.status(404).json({
      data: null,
      error: { message: `${result.notFound} not found`, code: 'NOT_FOUND' }
    });
  }
  if (result.inactive) {
    return res.status(422).json({
      data: null,
      error: { message: 'Fee item is inactive', code: 'INACTIVE_FEE_ITEM' }
    });
  }

  res.status(201).json({ data: result.charge, error: null });
});

router.post('/bulk', requireSession, async (req, res) => {
  const { feeItemId, classLabel } = req.body || {};

  if (!feeItemId) {
    return res.status(400).json({
      data: null,
      error: { message: 'feeItemId is required', code: 'BAD_REQUEST' }
    });
  }

  const result = await withTenant(req.ctx.tenantId, async (client) => {
    const fee = await client.query(
      'SELECT id, amount_minor, active FROM fee_items WHERE id = $1',
      [feeItemId]
    );
    if (!fee.rows[0]) return { notFound: true };
    if (!fee.rows[0].active) return { inactive: true };

    const inserted = await client.query(
      `INSERT INTO charges (tenant_id, student_id, fee_item_id, amount_minor)
       SELECT $1, s.id, $2, $3
       FROM students s
       WHERE s.deleted_at IS NULL
         AND ($4::text IS NULL OR s.class_label = $4)
       RETURNING id`,
      [req.ctx.tenantId, feeItemId, fee.rows[0].amount_minor, classLabel || null]
    );
    return { created: inserted.rowCount };
  });

  if (result.notFound) {
    return res.status(404).json({
      data: null,
      error: { message: 'Fee item not found', code: 'NOT_FOUND' }
    });
  }
  if (result.inactive) {
    return res.status(422).json({
      data: null,
      error: { message: 'Fee item is inactive', code: 'INACTIVE_FEE_ITEM' }
    });
  }

  res.status(201).json({ data: { created: result.created }, error: null });
});



module.exports = router;