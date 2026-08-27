const express = require('express');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();

// List runs — the bursar sees these read-only
router.get('/', requireSession, async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `SELECT r.id, r.period, r.status, r.total_minor, r.created_at,
              r.approved_at, r.paid_at,
              a.email AS approved_by_email,
              p.email AS paid_by_email,
              COUNT(l.id) AS staff_count
       FROM payroll_runs r
       LEFT JOIN users a ON a.id = r.approved_by
       LEFT JOIN users p ON p.id = r.paid_by
       LEFT JOIN payroll_lines l ON l.payroll_run_id = r.id
       GROUP BY r.id, a.email, p.email
       ORDER BY r.period DESC`
    )
  );
  res.json({ data: result.rows, error: null });
});

// One run, with its lines
router.get('/:id', requireSession, async (req, res) => {
  const data = await withTenant(req.ctx.tenantId, async (client) => {
    const run = await client.query(
      `SELECT r.id, r.period, r.status, r.total_minor, r.created_at,
              r.approved_at, r.paid_at,
              a.email AS approved_by_email, p.email AS paid_by_email
       FROM payroll_runs r
       LEFT JOIN users a ON a.id = r.approved_by
       LEFT JOIN users p ON p.id = r.paid_by
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!run.rows[0]) return null;

    const lines = await client.query(
      `SELECT l.id, l.staff_id, s.full_name, s.role_title, s.msisdn,
              l.gross_minor, l.notified_at
       FROM payroll_lines l
       JOIN staff s ON s.id = l.staff_id
       WHERE l.payroll_run_id = $1
       ORDER BY s.full_name`,
      [req.params.id]
    );

    return { ...run.rows[0], lines: lines.rows };
  });

  if (!data) {
    return res.status(404).json({
      data: null, error: { message: 'Payroll run not found', code: 'NOT_FOUND' }
    });
  }
  res.json({ data, error: null });
});

// Create a draft run for a period.
// UNIQUE (tenant_id, period) makes this idempotent — a second attempt for
// the same month violates the constraint and is refused, so a retried cron
// or a double click cannot create two runs.
router.post('/', requireSession, requireRole('manager'), async (req, res) => {
  const { period } = req.body || {};

  if (!/^\d{4}-\d{2}$/.test(period || '')) {
    return res.status(400).json({
      data: null,
      error: { message: 'period must be in YYYY-MM format', code: 'BAD_PERIOD' }
    });
  }

  try {
    const result = await withTenant(req.ctx.tenantId, async (client) => {
      const run = await client.query(
        `INSERT INTO payroll_runs (tenant_id, period, status, created_by)
         VALUES ($1, $2, 'draft', $3)
         RETURNING id, period, status, created_at`,
        [req.ctx.tenantId, period, req.ctx.userId]
      );
      const runId = run.rows[0].id;

      // gross_minor is SNAPSHOTTED onto the line, not joined at read time.
      // A raise next month must not rewrite this month's payslip.
      const lines = await client.query(
        `INSERT INTO payroll_lines (tenant_id, payroll_run_id, staff_id, gross_minor)
         SELECT $1, $2, s.id, s.gross_minor
         FROM staff s
         WHERE s.active = TRUE AND s.deleted_at IS NULL
         RETURNING gross_minor`,
        [req.ctx.tenantId, runId]
      );

      const total = lines.rows.reduce((sum, l) => sum + Number(l.gross_minor), 0);

      await client.query(
        'UPDATE payroll_runs SET total_minor = $2 WHERE id = $1',
        [runId, total]
      );

      return { ...run.rows[0], totalMinor: total, staffCount: lines.rowCount };
    });

    res.status(201).json({ data: result, error: null });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        data: null,
        error: { message: `A payroll run for ${period} already exists`, code: 'DUPLICATE_PERIOD' }
      });
    }
    throw err;
  }
});

// draft -> approved. Sends nothing: staff are told at mark-paid, so nobody
// is notified about money that has not moved.
router.post('/:id/approve', requireSession, requireRole('manager'), async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, async (client) => {
    const run = await client.query(
      'SELECT id, status, period, total_minor FROM payroll_runs WHERE id = $1',
      [req.params.id]
    );
    if (!run.rows[0]) return { notFound: true };
    if (run.rows[0].status !== 'draft') return { wrongStatus: run.rows[0].status };

    const updated = await client.query(
      `UPDATE payroll_runs
       SET status = 'approved', approved_by = $2, approved_at = now()
       WHERE id = $1
       RETURNING id, period, status, total_minor, approved_at`,
      [req.params.id, req.ctx.userId]
    );

    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, changes)
       VALUES ($1, $2, 'payroll.approved', 'payroll_run', $3, $4)`,
      [req.ctx.tenantId, req.ctx.userId, req.params.id,
       JSON.stringify({ period: run.rows[0].period, totalMinor: run.rows[0].total_minor })]
    );

    return { run: updated.rows[0] };
  });

  if (result.notFound) {
    return res.status(404).json({ data: null, error: { message: 'Payroll run not found', code: 'NOT_FOUND' } });
  }
  if (result.wrongStatus) {
    return res.status(409).json({
      data: null,
      error: { message: `Run is ${result.wrongStatus}, not draft`, code: 'INVALID_STATE' }
    });
  }

  res.json({ data: result.run, error: null });
});

// approved -> paid. The system does NOT move money — M-Pesa B2C is out of
// scope. The transfer happens outside and is recorded here.
router.post('/:id/mark-paid', requireSession, requireRole('manager'), async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, async (client) => {
    const run = await client.query(
      'SELECT id, status, period, total_minor FROM payroll_runs WHERE id = $1',
      [req.params.id]
    );
    if (!run.rows[0]) return { notFound: true };
    if (run.rows[0].status !== 'approved') return { wrongStatus: run.rows[0].status };

    const updated = await client.query(
      `UPDATE payroll_runs
       SET status = 'paid', paid_by = $2, paid_at = now()
       WHERE id = $1
       RETURNING id, period, status, total_minor, paid_at`,
      [req.params.id, req.ctx.userId]
    );

    // Stamped per line so one bad phone number does not obscure whether
    // the rest were told. A BullMQ job per line would send the SMS.
    const notified = await client.query(
      `UPDATE payroll_lines SET notified_at = now()
       WHERE payroll_run_id = $1 RETURNING id`,
      [req.params.id]
    );

    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, changes)
       VALUES ($1, $2, 'payroll.paid', 'payroll_run', $3, $4)`,
      [req.ctx.tenantId, req.ctx.userId, req.params.id,
       JSON.stringify({ period: run.rows[0].period, totalMinor: run.rows[0].total_minor,
                        notifiedCount: notified.rowCount })]
    );

    return { run: updated.rows[0], notified: notified.rowCount };
  });

  if (result.notFound) {
    return res.status(404).json({ data: null, error: { message: 'Payroll run not found', code: 'NOT_FOUND' } });
  }
  if (result.wrongStatus) {
    return res.status(409).json({
      data: null,
      error: { message: `Run is ${result.wrongStatus}, not approved`, code: 'INVALID_STATE' }
    });
  }

  res.json({ data: { ...result.run, notified: result.notified }, error: null });
});

module.exports = router;