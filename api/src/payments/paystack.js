const BASE = 'https://api.paystack.co';

// Paystack works in whole units of the currency's minor denomination —
// kobo for NGN, cents for KES. Same as our amount_minor, so no conversion.
async function initialisePaystack({ email, amountMinor, reference }) {
  const res = await fetch(`${BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: amountMinor,
      currency: 'KES',
      reference,
      callback_url: process.env.PAYSTACK_CALLBACK_URL,
    }),
  });

  return res.json();
}

// Used by the reconciliation path — asks Paystack directly rather than
// trusting a webhook we might have missed.
async function verifyPaystack(reference) {
  const res = await fetch(`${BASE}/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  return res.json();
}

module.exports = { initialisePaystack, verifyPaystack };