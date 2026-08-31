const { stkPush } = require('../mpesa/daraja');
const { initialisePaystack } = require('./paystack');

// Which provider handles a payment depends on the payer's number.
// M-Pesa only accepts Kenyan numbers; everyone else pays by card.
function providerFor(msisdn) {
  return msisdn.startsWith('+254') ? 'mpesa' : 'paystack';
}

// One interface, two providers. Callers do not know which one ran.
async function startPayment({ msisdn, email, amountMinor, reference, description }) {
  const provider = providerFor(msisdn);

  if (provider === 'mpesa') {
    const result = await stkPush({ msisdn, amountMinor, reference, description });
    if (result.ResponseCode !== '0') {
      return { ok: false, provider, error: result.errorMessage || result.ResponseDescription };
    }
    return {
      ok: true,
      provider,
      providerReference: result.CheckoutRequestID,
      instruction: 'Check your phone for the M-Pesa prompt and enter your PIN.',
    };
  }

  const result = await initialisePaystack({ email, amountMinor, reference });
  if (!result.status) {
    return { ok: false, provider, error: result.message };
  }
  return {
    ok: true,
    provider,
    providerReference: result.data.reference,
    paymentUrl: result.data.authorization_url,
    instruction: 'Open the link we have sent you to pay by card.',
  };
}

module.exports = { startPayment, providerFor };