const express = require('express');
const { withTenant } = require('../db/withTenant');
const { requireSession } = require('../middleware/requireSession');

const router = express.Router();

router.get('/', requireSession, async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `SELECT a.id, a.title, a.body, a.target_type, a.target_class_label,
              a.created_at, u.email AS created_by_email,
              COUNT(d.id) AS total,
              COUNT(*) FILTER (WHERE d.status = 'delivered') AS delivered,
              COUNT(*) FILTER (WHERE d.status = 'failed')    AS failed,
              COUNT(*) FILTER (WHERE d.status = 'queued')    AS queued
       FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN announcement_deliveries d ON d.announcement_id = a.id
       GROUP BY a.id, u.email
       ORDER BY a.created_at DESC`
    )
  );
  res.json({ data: result.rows, error: null });
});

// The tick list: every intended recipient and what happened to each
router.get('/:id/deliveries', requireSession, async (req, res) => {
  const result = await withTenant(req.ctx.tenantId, (client) =>
    client.query(
      `SELECT d.id, d.guardian_id, g.full_name, g.msisdn,
              d.channel, d.status, d.error_message, d.sent_at
       FROM announcement_deliveries d
       JOIN guardians g ON g.id = d.guardian_id
       WHERE d.announcement_id = $1
       ORDER BY g.full_name`,
      [req.params.id]
    )
  );
  res.json({ data: result.rows, error: null });
});

router.post('/', requireSession, async (req, res) => {
  const { title, body, targetType, targetClassLabel, channel } = req.body || {};

  if (!title || !body) {
    return res.status(400).json({
      data: null,
      error: { message: 'title and body are required', code: 'BAD_REQUEST' }
    });
  }

  const target = targetType || 'all';
  if (!['all', 'class'].includes(target)) {
    return res.status(422).json({
      data: null,
      error: { message: 'targetType must be all or class', code: 'INVALID_TARGET' }
    });
  }
  if (target === 'class' && !targetClassLabel) {
    return res.status(400).json({
      data: null,
      error: { message: 'targetClassLabel is required when targeting a class', code: 'BAD_REQUEST' }
    });
  }

  // USSD is not a valid channel: it only works when the parent dials in,
  // so nothing can be pushed to them.
  const ch = channel || 'sms';
  if (!['sms', 'whatsapp'].includes(ch)) {
    return res.status(422).json({
      data: null,
      error: { message: 'channel must be sms or whatsapp', code: 'INVALID_CHANNEL' }
    });
  }

  const result = await withTenant(req.ctx.tenantId, async (client) => {
    const announcement = await client.query(
      `INSERT INTO announcements (tenant_id, created_by, title, body,
                                  target_type, target_class_label)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, created_at`,
      [req.ctx.tenantId, req.ctx.userId, title, body, target,
       target === 'class' ? targetClassLabel : null]
    );
    const id = announcement.rows[0].id;

    // One delivery row per intended recipient, written BEFORE anything is
    // sent — so the bursar can later answer "did Mary get it?". A missing
    // row would be ambiguous: failed, or never included?
    const deliveries = await client.query(
      `INSERT INTO announcement_deliveries
         (tenant_id, announcement_id, guardian_id, channel, status)
        SELECT DISTINCT $1::uuid, $2::uuid, g.id, $3::text, 'queued'
       FROM guardians g
       JOIN guardian_students gs ON gs.guardian_id = g.id
       JOIN students s ON s.id = gs.student_id
       WHERE s.deleted_at IS NULL
         AND ($4::text IS NULL OR s.class_label = $4)
       RETURNING id`,
      [req.ctx.tenantId, id, ch, target === 'class' ? targetClassLabel : null]
    );

    return { ...announcement.rows[0], recipientCount: deliveries.rowCount };
  });

  if (result.recipientCount === 0) {
    return res.status(422).json({
      data: null,
      error: { message: 'No registered guardians match that target', code: 'NO_RECIPIENTS' }
    });
  }

  res.status(201).json({ data: result, error: null });
});

module.exports = router;