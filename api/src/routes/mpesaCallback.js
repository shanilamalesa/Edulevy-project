const express = require('express');
const { withTenant } = require('../db/withTenant');
const { pool } = require('../db/pool');

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

  // Find the pending row. No tenant context yet, so this runs on the raw pool.
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

  if (!payment || payment.status !== 'pending') {
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

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
  return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}

  // Success — pull the receipt out of the metadata array
  const items = cb.CallbackMetadata?.Item || [];
  const get = (name) => items.find((i) => i.Name === name)?.Value;
  const receipt = get('MpesaReceiptNumber');

  await withTenant(lookup.tenant_id, (client) =>
    client.query(
      `UPDATE payments SET status = 'settled',
                           provider_ref = $2,
                           raw_payload = raw_payload || $3::jsonb
       WHERE id = $1`,
      [payment.id, receipt, JSON.stringify({ callback: cb })]
    )
  );

  console.log(`payment ${payment.id} settled: ${receipt}`);
  return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

module.exports = router;