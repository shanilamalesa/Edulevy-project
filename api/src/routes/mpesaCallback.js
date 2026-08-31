const express = require('express');
const { withTenant } = require('../db/withTenant');
const { pool } = require('../db/pool');
const { publish } = require('../events/bus');
const crypto = require('crypto');
const { sendSMS } = require('../notify/sms');

const router = express.Router();

// Daraja result codes worth naming
const FAILURE_REASONS = {
  1: 'Insufficient funds',
  1032: 'Cancelled by user',
  1037: 'Timeout — user did not respond',
  2001: 'Wrong PIN',
};

router.post('/', async (req, res) => {
  const cb = req.body?.Body?.stkCallback;

  // Always acknowledge, even on rubbish — a non-200 makes Safaricom retry
  if (!cb) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const { CheckoutRequestID, ResultCode, ResultDesc } = cb;

  // payment_lookup has no RLS — it resolves the tenant, so it must be
  // readable before any tenant context exists
  const found = await pool.query(
    'SELECT tenant_id, payment_id FROM payment_lookup WHERE checkout_request_id = $1',
    [CheckoutRequestID]
  );
  const lookup = found.rows[0];

  if (!lookup) {
    console.warn('callback for unknown checkout id:', CheckoutRequestID);
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  const current = await withTenant(lookup.tenant_id, (client) =>
    client.query('SELECT id, status FROM payments WHERE id = $1', [lookup.payment_id])
  );
  const payment = current.rows[0];

  // Already handled — a repeat delivery. Idempotency.
  if (!payment || payment.status !== 'pending') {
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  // ── Failure ──
  if (ResultCode !== 0) {
    const reason = FAILURE_REASONS[ResultCode] || ResultDesc;

    await withTenant(lookup.tenant_id, (client) =>
      client.query(
        `UPDATE payments SET status = 'failed',
                             raw_payload = raw_payload || $2::jsonb
         WHERE id = $1`,
        [payment.id, JSON.stringify({ callback: cb, reason })]
      )
    );

    console.log(`payment ${payment.id} failed: ${reason}`);

    await publish(lookup.tenant_id, 'payment.failed', {
      paymentId: payment.id,
      reason,
    });

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

   // ── Success ──
  const items = cb.CallbackMetadata?.Item || [];
  const get = (name) => items.find((i) => i.Name === name)?.Value;
  const receipt = get('MpesaReceiptNumber');

  // Unguessable, because the receipt link is opened without logging in
  const token = crypto.randomBytes(16).toString('hex');

  await withTenant(lookup.tenant_id, (client) =>
    client.query(
      `UPDATE payments SET status = 'settled',
                           provider_ref = $2,
                           receipt_token = $3,
                           raw_payload = raw_payload || $4::jsonb
       WHERE id = $1`,
      [payment.id, receipt, token, JSON.stringify({ callback: cb })]
    )
  );

  console.log(`payment ${payment.id} settled: ${receipt}`);

  await publish(lookup.tenant_id, 'payment.settled', {
    paymentId: payment.id,
    receipt,
    amountMinor: get('Amount') ? get('Amount') * 100 : null,
  });

  // Confirmation SMS with the receipt link
  const details = await withTenant(lookup.tenant_id, (client) =>
    client.query(
      `SELECT s.full_name, s.admission_no, g.msisdn, p.amount_minor
       FROM payments p
       JOIN students s ON s.id = p.student_id
       LEFT JOIN guardians g ON g.id = p.paid_by_guardian_id
       WHERE p.id = $1`,
      [payment.id]
    )
  );
  const d = details.rows[0];

  if (d?.msisdn) {
    await sendSMS(d.msisdn,
      `Payment received for ${d.full_name}, admission ${d.admission_no}. ` +
      `KES ${(Number(d.amount_minor) / 100).toLocaleString()}. ` +
      `Receipt: ${process.env.PUBLIC_URL}/r/${token}`);
  }

  return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

module.exports = router;
