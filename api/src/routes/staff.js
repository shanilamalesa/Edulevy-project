
const express = require('express');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

router.get('/', requireSession, async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `SELECT id, full_name, msisdn, role_title, gross_minor, active, created_at
       FROM staff WHERE deleted_at IS NULL ORDER BY full_name`
    )
  );
  res.json({ data: result.rows, error: null });
});

// Manager only — a salary figure commits the school's money
router.post('/', requireSession, requireRole('manager'), async (req, res) => {
  const { fullName, msisdn, roleTitle, grossMinor } = req.body || {};

  if (!fullName || !msisdn) {
    return res.status(400).json({
      data: null,
      error: { message: 'fullName and msisdn are required', code: 'BAD_REQUEST' }
    });
  }
  if (!Number.isInteger(grossMinor) || grossMinor <= 0) {
    return res.status(400).json({
      data: null,
      error: { message: 'grossMinor must be a positive integer', code: 'BAD_AMOUNT' }
    });
  }

  try {
    const result = await withTenant(req.ctx.tenantId, (client) =>
      client.query(
        `INSERT INTO staff (tenant_id, full_name, msisdn, role_title, gross_minor)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, full_name, msisdn, role_title, gross_minor, active`,
        [req.ctx.tenantId, fullName, msisdn, roleTitle || null, grossMinor]
      )
    );
    res.status(201).json({ data: result.rows[0], error: null });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        data: null,
        error: { message: 'That number already belongs to a staff member', code: 'DUPLICATE_MSISDN' }
      });
    }
    throw err;
  }
});

// Changing a salary affects FUTURE runs only — existing payroll_lines hold
// a snapshot, so a raise does not rewrite last month's payslip.
router.patch('/:id', requireSession, requireRole('manager'), async (req, res) => {
  const { fullName, roleTitle, grossMinor, active } = req.body || {};

  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `UPDATE staff SET
         full_name   = COALESCE($2, full_name),
         role_title  = COALESCE($3, role_title),
         gross_minor = COALESCE($4, gross_minor),
         active      = COALESCE($5, active)
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, full_name, msisdn, role_title, gross_minor, active`,
      [req.params.id, fullName || null, roleTitle || null,
       grossMinor || null, active === undefined ? null : active]
    )
  );

  if (!result.rows[0]) {
    return res.status(404).json({
      data: null, error: { message: 'Staff member not found', code: 'NOT_FOUND' }
    });
  }
  res.json({ data: result.rows[0], error: null });
});

module.exports = router;