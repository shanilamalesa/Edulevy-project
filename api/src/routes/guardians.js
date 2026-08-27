const express = require('express');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');

const router = express.Router();

// Normalise to E.164 before storing. Without this, "0712...", "254712..."
// and "+254712..." are three different strings and the unique constraint
// catches none of them — the same parent could register three times.
function normalise(raw, countryCode = 'KE') {
  const dial = { KE: '254', TZ: '255', UG: '256', GB: '44' }[countryCode] || '254';
  let n = String(raw).replace(/[\s\-()]/g, '');

  if (n.startsWith('+')) return n;
  if (n.startsWith('00')) return '+' + n.slice(2);
  if (n.startsWith('0')) return '+' + dial + n.slice(1);
  if (n.startsWith(dial)) return '+' + n;
  return '+' + dial + n;
}

router.get('/', requireSession, async (req, res) => {
  const { search } = req.query;

  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `SELECT g.id, g.msisdn, g.full_name, g.created_at,
              (g.pin_hash IS NOT NULL) AS pin_set,
              (g.pin_locked_at IS NOT NULL) AS pin_locked,
              COALESCE(
                json_agg(
                  json_build_object('id', s.id, 'fullName', s.full_name,
                                    'admissionNo', s.admission_no)
                ) FILTER (WHERE s.id IS NOT NULL), '[]'
              ) AS students
       FROM guardians g
       LEFT JOIN guardian_students gs ON gs.guardian_id = g.id
       LEFT JOIN students s ON s.id = gs.student_id AND s.deleted_at IS NULL
       WHERE ($1::text IS NULL
              OR g.full_name ILIKE '%' || $1 || '%'
              OR g.msisdn ILIKE '%' || $1 || '%')
       GROUP BY g.id
       ORDER BY g.full_name`,
      [search || null]
    )
  );

  res.json({ data: result.rows, error: null });
});

router.post('/', requireSession, async (req, res) => {
  const { msisdn, fullName } = req.body || {};

  if (!msisdn) {
    return res.status(400).json({
      data: null,
      error: { message: 'msisdn is required', code: 'BAD_REQUEST' }
    });
  }

  const normalised = normalise(msisdn);

  if (!/^\+\d{9,15}$/.test(normalised)) {
    return res.status(400).json({
      data: null,
      error: { message: 'Phone number is not valid', code: 'INVALID_MSISDN' }
    });
  }

  try {
    const result = await withTenant(req.ctx.tenantId, (client) =>
      client.query(
        `INSERT INTO guardians (tenant_id, msisdn, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, msisdn, full_name, created_at`,
        [req.ctx.tenantId, normalised, fullName || null]
      )
    );
    res.status(201).json({ data: result.rows[0], error: null });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        data: null,
        error: { message: 'That number is already registered at this school', code: 'DUPLICATE_MSISDN' }
      });
    }
    throw err;
  }
});

// Link a guardian to a student. THIS IS THE AUTHORIZATION BOUNDARY for
// USSD and WhatsApp — it decides which children this number may see.
router.post('/:id/students', requireSession, async (req, res) => {
  const { studentId } = req.body || {};

  if (!studentId) {
    return res.status(400).json({
      data: null,
      error: { message: 'studentId is required', code: 'BAD_REQUEST' }
    });
  }

  const result = await withTenant(req.ctx.tenantId, async (client) => {
    const guardian = await client.query('SELECT id FROM guardians WHERE id = $1', [req.params.id]);
    if (!guardian.rows[0]) return { notFound: 'guardian' };

    const student = await client.query(
      'SELECT id, full_name FROM students WHERE id = $1 AND deleted_at IS NULL',
      [studentId]
    );
    if (!student.rows[0]) return { notFound: 'student' };

    try {
      await client.query(
        `INSERT INTO guardian_students (guardian_id, student_id, tenant_id)
         VALUES ($1, $2, $3)`,
        [req.params.id, studentId, req.ctx.tenantId]
      );
    } catch (err) {
      if (err.code === '23505') return { alreadyLinked: true };
      throw err;
    }

    return { linked: student.rows[0] };
  });

  if (result.notFound) {
    return res.status(404).json({
      data: null,
      error: { message: `${result.notFound} not found`, code: 'NOT_FOUND' }
    });
  }
  if (result.alreadyLinked) {
    return res.status(409).json({
      data: null,
      error: { message: 'Already linked', code: 'ALREADY_LINKED' }
    });
  }

  res.status(201).json({ data: result.linked, error: null });
});

// Unlink — revokes that number's access to that child
router.delete('/:id/students/:studentId', requireSession, async (req, res) => {
  await withTenant(req.ctx.tenantId, async (client) => {
    await client.query(
      'DELETE FROM guardian_students WHERE guardian_id = $1 AND student_id = $2',
      [req.params.id, req.params.studentId]
    );

    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, changes)
       VALUES ($1, $2, 'guardian.unlinked', 'guardian', $3, $4)`,
      [req.ctx.tenantId, req.ctx.userId, req.params.id,
       JSON.stringify({ studentId: req.params.studentId })]
    );
  });

  res.status(204).send();
});

module.exports = router;