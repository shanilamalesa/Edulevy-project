const express = require('express');
const { pool } = require('../db/pool');
const { withTenant } = require('../db/withTenant');
const { getState, setState, clearState } = require('../whatsapp/state');
const { sendWhatsApp } = require('../whatsapp/send');
const { startPayment } = require('../payments');

const router = express.Router();

router.post('/', async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const msisdn = from.replace('whatsapp:', '');

  let reply;
  try {
    reply = await handle(from, msisdn, body);
  } catch (err) {
    console.error('whatsapp handler error:', err);
    reply = 'Sorry, something went wrong. Please try again.';
  }

  // Reply in the HTTP response as TwiML. This avoids the Messages API,
  // which a trial account rejects without a content template.
  const escaped = (reply || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  res.set('Content-Type', 'text/xml');
  res.send(`<Response><Message>${escaped}</Message></Response>`);
});

// Words that always reset the conversation, whatever step the parent is on.
// WhatsApp conversations never end on their own, so someone who walks away
// and comes back mid-flow needs a way out.
const RESET_WORDS = ['hi', 'hello', 'hey', 'start', 'menu', 'help', 'restart'];

const WELCOME =
  'Welcome to EduLevy.\n\n' +
  'Pay school fees from your phone — no app, no internet needed.\n\n' +
  'Reply with your school\'s 3-digit code to begin.\n' +
  'For example: 001\n\n' +
  'Type MENU at any time to start over.';

const CATEGORY_MENU =
  '1. School Fees\n2. Trips\n3. Clubs\n4. Sports\n\n0. Back';

async function handle(from, msisdn, body) {
  // Reset works from any step
  if (RESET_WORDS.includes(body.toLowerCase())) {
    await clearState(from);
    return WELCOME;
  }

  const state = await getState(from);

  // ── Step 1: which school ──
  if (state.step === 'ENTRY') {
    if (!/^\d{3}$/.test(body)) return WELCOME;

    const result = await pool.query(
      'SELECT id, name FROM tenants WHERE ussd_ext = $1 AND deleted_at IS NULL',
      [body]
    );
    const tenant = result.rows[0];

    if (!tenant) {
      return `Sorry, "${body}" is not a school code we recognise.\n\n` +
             'Please check with your school office and try again.';
    }

    // THE AUTHORIZATION BOUNDARY — only children linked to this number
    const students = await withTenant(tenant.id, (client) =>
      client.query(
        `SELECT s.id, s.full_name
         FROM students s
         JOIN guardian_students gs ON gs.student_id = s.id
         JOIN guardians g ON g.id = gs.guardian_id
         WHERE g.msisdn = $1
         ORDER BY s.full_name`,
        [msisdn]
      )
    );

    if (students.rows.length === 0) {
      await clearState(from);
      return `${tenant.name}\n\n` +
             'This number is not registered with the school.\n\n' +
             'Please visit the school office to register, then try again.';
    }

    const menu = students.rows.map((s, i) => `${i + 1}. ${s.full_name}`).join('\n');
    await setState(from, {
      step: 'CHOOSE_STUDENT',
      tenantId: tenant.id,
      tenantName: tenant.name,
      students: students.rows,
    });

    return `${tenant.name}\n\nWhich student are you paying for?\n\n${menu}`;
  }

  // ── Step 2: which child ──
  if (state.step === 'CHOOSE_STUDENT') {
    const student = state.students[parseInt(body, 10) - 1];

    if (!student) {
      const menu = state.students.map((s, i) => `${i + 1}. ${s.full_name}`).join('\n');
      return `Please reply with a number from the list.\n\n${menu}`;
    }

    await setState(from, { ...state, step: 'CHOOSE_CATEGORY', student });
    return `${student.full_name}\n\nWhat are you paying for?\n\n${CATEGORY_MENU}`;
  }

  // ── Step 3: which category, and what is owed ──
  if (state.step === 'CHOOSE_CATEGORY') {
    if (body === '0') {
      const menu = state.students.map((s, i) => `${i + 1}. ${s.full_name}`).join('\n');
      await setState(from, { ...state, step: 'CHOOSE_STUDENT' });
      return `${state.tenantName}\n\nWhich student are you paying for?\n\n${menu}`;
    }

    const categories = { '1': 'tuition', '2': 'trip', '3': 'club', '4': 'sport' };
    const labels = { tuition: 'School Fees', trip: 'Trips', club: 'Clubs', sport: 'Sports' };
    const category = categories[body];

    if (!category) {
      return `Please reply 1, 2, 3 or 4.\n\n${CATEGORY_MENU}`;
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
      await setState(from, { ...state, step: 'CHOOSE_CATEGORY' });
      return `${state.student.full_name} has nothing outstanding for ${labels[category]}.\n\n` +
             `Choose something else, or type MENU to start over.\n\n${CATEGORY_MENU}`;
    }

    await setState(from, { ...state, step: 'ENTER_AMOUNT', category, charged });

    return `${state.student.full_name}\n${labels[category]}\n\n` +
           `Outstanding: KES ${(charged / 100).toLocaleString()}\n\n` +
           'How much would you like to pay?\n' +
           'Reply with the amount in shillings, or type ALL to pay in full.';
  }

  // ── Step 4: how much ──
  if (state.step === 'ENTER_AMOUNT') {
    const labels = { tuition: 'School Fees', trip: 'Trips', club: 'Clubs', sport: 'Sports' };

    let amountMinor;
    if (body.toLowerCase() === 'all') {
      amountMinor = state.charged;
    } else {
      amountMinor = Math.round(parseFloat(body.replace(/,/g, '')) * 100);
    }

    if (!amountMinor || isNaN(amountMinor) || amountMinor <= 0) {
      return 'That does not look like a valid amount.\n\n' +
             'Reply with a number, for example 5000, or type ALL to pay in full.';
    }

    await setState(from, { ...state, step: 'CONFIRM', amountMinor });

    return 'Please confirm:\n\n' +
           `Student: ${state.student.full_name}\n` +
           `For: ${labels[state.category]}\n` +
           `Amount: KES ${(amountMinor / 100).toLocaleString()}\n\n` +
           'How would you like to pay?\n' +
           '1. M-Pesa\n' +
           '2. Card\n' +
           '3. Cancel';
  }

  // ── Step 5: confirm and push ──

    if (state.step === 'CONFIRM') {
    if (body === '3') {
      await clearState(from);
      return 'Payment cancelled.\n\nType MENU when you would like to start again.';
    }

    if (body !== '1' && body !== '2') {
      return 'Reply 1 for M-Pesa, 2 for card, or 3 to cancel.';
    }

    const provider = body === '1' ? 'mpesa' : 'paystack';
    await clearState(from);

    const result = await startPayment({
      provider,
      msisdn,
      email: 'payments@edulevy.co.ke',
      amountMinor: state.amountMinor,
      reference: `EDU-${Date.now()}`,
      description: `${state.category} fees`,
    });

    if (!result.ok) {
      console.error('payment start failed:', result.error);
      return 'We could not start the payment just now.\n\n' +
             'Please try again in a moment, or pay at the school office.';
    }

    await withTenant(state.tenantId, async (client) => {
      const g = await client.query(
        'SELECT id FROM guardians WHERE msisdn = $1', [msisdn]
      );
      const guardianId = g.rows[0]?.id || null;

      const inserted = await client.query(
        `INSERT INTO payments (tenant_id, student_id, paid_by_guardian_id, provider,
                               checkout_request_id, amount_minor, status, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
         RETURNING id`,
        [state.tenantId, state.student.id, guardianId, result.provider,
         result.providerReference, state.amountMinor,
         JSON.stringify({ initiated: result, category: state.category, channel: 'whatsapp' })]
      );

      await client.query(
        `INSERT INTO payment_lookup (checkout_request_id, tenant_id, payment_id)
         VALUES ($1, $2, $3)`,
        [result.providerReference, state.tenantId, inserted.rows[0].id]
      );
    });

    if (result.paymentUrl) {
      return `Tap to pay by card:\n${result.paymentUrl}\n\n` +
             `KES ${(state.amountMinor / 100).toLocaleString()} for ${state.student.full_name}.`;
    }

    return 'Payment request sent.\n\n' +
           'Check your phone for the M-Pesa prompt and enter your PIN.';
  }
  
    await clearState(from);
  return WELCOME;
}

module.exports = router;