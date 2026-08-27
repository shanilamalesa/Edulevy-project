const express = require('express');
const { pool } = require('../db/pool');
const { getState, setState } = require('../ussd/state');
const { withTenant } = require('../db/withTenant');
const { stkPush } = require('../mpesa/daraja');

const router = express.Router();

router.post('/', async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  console.log('phone from AT:', phoneNumber); 
  res.set('Content-Type', 'text/plain');

  const parts = (text || '').split('*');
  const input = parts[parts.length - 1];

  const state = await getState(sessionId);

  // ── Screen 1: school code, then the caller's children ──
  if (state.step === 'ENTRY') {
    if (!input) return res.send('CON Enter your school code:');

    // tenants has no RLS — this is the only query that runs unscoped
    const result = await pool.query(
      'SELECT id, name FROM tenants WHERE ussd_ext = $1 AND deleted_at IS NULL',
      [input]
    );
    const tenant = result.rows[0];

    if (!tenant) return res.send('END School code not recognised.');

    // THE AUTHORIZATION BOUNDARY: only children linked to this number
    const students = await withTenant(tenant.id, (client) =>
      client.query(
        `SELECT s.id, s.full_name
         FROM students s
         JOIN guardian_students gs ON gs.student_id = s.id
         JOIN guardians g ON g.id = gs.guardian_id
         WHERE g.msisdn = $1
         ORDER BY s.full_name`,
        [phoneNumber]
      )
    );

    if (students.rows.length === 0) {
      return res.send('END This number is not registered. Please see the school office.');
    }

    const menu = students.rows.map((s, i) => `${i + 1}. ${s.full_name}`).join('\n');

    await setState(sessionId, {
      step: 'CHOOSE_STUDENT',
      tenantId: tenant.id,
      students: students.rows,
    });

    return res.send(`CON ${tenant.name}\nSelect student:\n${menu}`);
  }

  // ── Screen 2: which child ──
  if (state.step === 'CHOOSE_STUDENT') {
    const index = parseInt(input, 10) - 1;
    const student = state.students[index];

    if (!student) {
      const menu = state.students.map((s, i) => `${i + 1}. ${s.full_name}`).join('\n');
      return res.send(`CON Invalid choice.\nSelect student:\n${menu}`);
    }

    await setState(sessionId, { ...state, step: 'CHOOSE_CATEGORY', student });

    return res.send(
      `CON ${student.full_name}\n1. School Fees\n2. Trips\n3. Clubs\n4. Sports`
    );
  }

  // ── Screen 3: which category, and what is owed ──
  if (state.step === 'CHOOSE_CATEGORY') {
    const categories = { '1': 'tuition', '2': 'trip', '3': 'club', '4': 'sport' };
    const category = categories[input];

    if (!category) {
      return res.send('CON Invalid choice.\n1. School Fees\n2. Trips\n3. Clubs\n4. Sports');
    }

    const owing = await withTenant(state.tenantId, (client) =>
      client.query(
        `SELECT COALESCE(SUM(c.amount_minor), 0) AS charged
         FROM charges c
         JOIN fee_items fi ON fi.id = c.fee_item_id
         WHERE c.student_id = $1 AND fi.category = $2`,
        [state.student.id, category]
      )
    );

    const charged = Number(owing.rows[0].charged);

    if (charged === 0) {
      return res.send(`END No ${category} fees due for ${state.student.full_name}.`);
    }

    await setState(sessionId, { ...state, step: 'ENTER_AMOUNT', category, charged });

    return res.send(
      `CON ${state.student.full_name}\n${category}: KES ${charged / 100}\nEnter amount to pay:`
    );
  }

  // ── Screen 4: how much ──
  if (state.step === 'ENTER_AMOUNT') {
    const amountMinor = Math.round(parseFloat(input) * 100);

    if (!amountMinor || amountMinor <= 0) {
      return res.send('CON Invalid amount.\nEnter amount to pay:');
    }

    await setState(sessionId, { ...state, step: 'CONFIRM', amountMinor });

    return res.send(
      `CON Confirm payment\n${state.student.full_name}\n${state.category}: KES ${amountMinor / 100}\n1. Confirm\n2. Cancel`
    );
  }

  // ── Screen 5: confirm ──
  if (state.step === 'CONFIRM') {
    
    if (input !== '1') return res.send('END Payment cancelled.');

    // Day 6: the STK Push gets queued here
    const result = await stkPush({
        msisdn: phoneNumber,
        amountMinor: state.amountMinor,
        reference: state.student.full_name,
        description: `${state.category} fees`,
    });

    console.log('stk result:', result);

    if (result.ResponseCode !== '0') {
        return res.send('END Could not start payment. Please try again.');
    }

   
    // Record it as pending — the callback will settle it
    await withTenant(state.tenantId, async (client) => {
  const inserted = await client.query(
    `INSERT INTO payments (tenant_id, student_id, provider, checkout_request_id,
                           amount_minor, status, raw_payload)
     VALUES ($1, $2, 'mpesa', $3, $4, 'pending', $5)
     RETURNING id`,
    [
      state.tenantId,
      state.student.id,
      result.CheckoutRequestID,
      state.amountMinor,
      JSON.stringify({ initiated: result, category: state.category }),
    ]
  );

  // Lookup row so the callback can resolve the tenant before RLS applies
  await client.query(
    `INSERT INTO payment_lookup (checkout_request_id, tenant_id, payment_id)
     VALUES ($1, $2, $3)`,
    [result.CheckoutRequestID, state.tenantId, inserted.rows[0].id]
  );
});

return res.send('END Payment request sent. Check your phone for the M-Pesa prompt.');
  }

  return res.send('END Something went wrong.');
});

module.exports = router;