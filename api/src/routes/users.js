const express = require('express');
const argon2 = require('argon2');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');
const { requireRole } = require('../middleware/requireRole');
const redis = require('../db/redis');

const router = express.Router();

// Manager only, throughout: creating and removing accounts is school
// administration, not day-to-day work.
router.get('/', requireSession, requireRole('manager'), async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `SELECT id, email, role, status, created_at, deleted_at
       FROM users ORDER BY deleted_at NULLS FIRST, email`
    )
  );
  res.json({ data: result.rows, error: null });
});

router.post('/', requireSession, requireRole('manager'), async (req, res) => {
  const { email, password, role } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      data: null,
      error: { message: 'email and password are required', code: 'BAD_REQUEST' }
    });
  }
  if (!['bursar', 'manager'].includes(role)) {
    return res.status(422).json({
      data: null,
      error: { message: 'role must be bursar or manager', code: 'INVALID_ROLE' }
    });
  }
  if (password.length < 8) {
    return res.status(400).json({
      data: null,
      error: { message: 'password must be at least 8 characters', code: 'WEAK_PASSWORD' }
    });
  }

  try {
    const hash = await argon2.hash(password);

    const result = await withTenant(req.ctx.tenantId, async (client) => {
      const user = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role, created_at`,
        [req.ctx.tenantId, email.trim(), hash, role]
      );

      await client.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, changes)
         VALUES ($1, $2, 'user.created', 'user', $3, $4)`,
        [req.ctx.tenantId, req.ctx.userId, user.rows[0].id,
         JSON.stringify({ email: email.trim(), role })]
      );

      return user.rows[0];
    });

    res.status(201).json({ data: result, error: null });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        data: null,
        error: { message: 'That email already has an account at this school', code: 'DUPLICATE_EMAIL' }
      });
    }
    throw err;
  }
});

// Deactivate, never delete. A user who approved an adjustment cannot be
// removed — ON DELETE RESTRICT protects the audit trail — and deleting
// them would leave a waiver with no traceable actor.
router.patch('/:id/deactivate', requireSession, requireRole('manager'), async (req, res) => {
  if (req.params.id === req.ctx.userId) {
    return res.status(422).json({
      data: null,
      error: { message: 'You cannot deactivate your own account', code: 'SELF_DEACTIVATE' }
    });
  }

  const result = await withTenant(req.ctx.tenantId, async (client) => {
    const user = await client.query(
      `UPDATE users SET deleted_at = now(), status = 'deactivated'
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, email, role`,
      [req.params.id]
    );
    if (!user.rows[0]) return null;

    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, changes)
       VALUES ($1, $2, 'user.deactivated', 'user', $3, $4)`,
      [req.ctx.tenantId, req.ctx.userId, req.params.id,
       JSON.stringify({ email: user.rows[0].email })]
    );

    return user.rows[0];
  });

  if (!result) {
    return res.status(404).json({
      data: null, error: { message: 'User not found or already inactive', code: 'NOT_FOUND' }
    });
  }

  // Kill any live session. This is the revocation a JWT cannot do — but
  // session keys are random, so without an index of a user's sessions we
  // cannot target theirs specifically. Noted as a gap.
  const ids = await redis.smembers(`user-sessions:${req.params.id}`);
  if (ids.length) {
    await redis.del(...ids.map((s) => `sess:${s}`));
    await redis.del(`user-sessions:${req.params.id}`);
  }

  res.json({ data: result, error: null });
});

router.patch('/:id/reactivate', requireSession, requireRole('manager'), async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `UPDATE users SET deleted_at = NULL, status = 'active' 
      WHERE id = $1 RETURNING id, email, role`,
      [req.params.id]
    )
  );

  if (!result.rows[0]) {
    return res.status(404).json({ data: null, error: { message: 'User not found', code: 'NOT_FOUND' } });
  }
  res.json({ data: result.rows[0], error: null });
});

router.patch('/:id/approve', requireSession, requireRole('manager'), async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, async (client) => {
    const user = await client.query(
      `UPDATE users SET status = 'active'
       WHERE id = $1 AND status = 'pending'
       RETURNING id, email, role`,
      [req.params.id]
    );
    if (!user.rows[0]) return null;

    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, changes)
       VALUES ($1, $2, 'user.approved', 'user', $3, $4)`,
      [req.ctx.tenantId, req.ctx.userId, req.params.id,
       JSON.stringify({ email: user.rows[0].email, role: user.rows[0].role })]
    );

    return user.rows[0];
  });

  if (!result) {
    return res.status(404).json({
      data: null, error: { message: 'No pending request found', code: 'NOT_FOUND' }
    });
  }
  res.json({ data: result, error: null });
});

module.exports = router;