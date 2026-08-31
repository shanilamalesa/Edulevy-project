const express = require('express');
const crypto = require('crypto');
const { withTenant } = require('../db/withTenant');
const { pool } = require('../db/pool');
const { publish } = require('../events/bus');

const router = express.Router();

// Paystack signs the raw body with HMAC SHA512. Unlike Daraja, which has
// no signature at all, this can be verified — so it must be, and on the
// RAW bytes before any parsing.
router.post('/', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const expected = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)              // Buffer, not parsed JSON
    .digest('hex');

  if (signature !== expected) {
    console.warn('paystack webhook: bad signature');
    return res.sendStatus(400);
  }

  const event = JSON.parse(req.body.toString());

  // Acknowledge immediately — Paystack retries on slow responses
  res.sendStatus(200);

  if (event.event !== 'charge.success') return;

  const reference = event.data.reference;

  const found = await pool.query(
    'SELECT tenant_id, payment_id FROM payment_lookup WHERE checkout_request_id = $1',
    [reference]
  );
  const lookup = found.rows[0];
  if (!lookup) {
    console.warn('paystack callback for unknown reference:', reference);
    return;
  }

  const current = await withTenant(lookup.tenant_id, (client) =>
    client.query('SELECT id, status FROM payments WHERE id = $1', [lookup.payment_id])
  );
  const payment = current.rows[0];

  // Idempotency — a repeat delivery finds it already settled and stops
  if (!payment || payment.status !== 'pending') return;

  await withTenant(lookup.tenant_id, (client) =>
    client.query(
      `UPDATE payments SET status = 'settled',
                           provider_ref = $2,
                           raw_payload = raw_payload || $3::jsonb
       WHERE id = $1`,
      [payment.id, event.data.reference, JSON.stringify({ callback: event })]
    )
  );

  console.log(`payment ${payment.id} settled via paystack: ${reference}`);

  await publish(lookup.tenant_id, 'payment.settled', {
    paymentId: payment.id,
    receipt: reference,
    amountMinor: event.data.amount,
  });
});

module.exports = router;