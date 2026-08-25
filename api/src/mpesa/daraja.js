const BASE = 'https://sandbox.safaricom.co.ke';

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  // Tokens last an hour; re-fetching per request will get you rate limited
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const res = await fetch(
    `${BASE}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (Number(data.expires_in) - 60) * 1000;  // 60s safety margin
  return cachedToken;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
         `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function stkPush({ msisdn, amountMinor, reference, description }) {
  const token = await getToken();
  const ts = timestamp();
  const shortcode = process.env.MPESA_SHORTCODE;

  const password = Buffer.from(
    `${shortcode}${process.env.MPESA_PASSKEY}${ts}`
  ).toString('base64');

  const res = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amountMinor / 100),      // Daraja wants whole shillings
      PartyA: msisdn.replace('+', ''),            // 254..., no plus
      PartyB: shortcode,
      PhoneNumber: msisdn.replace('+', ''),
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: reference,
      TransactionDesc: description,
    }),
  });

  return res.json();
}

module.exports = { stkPush };