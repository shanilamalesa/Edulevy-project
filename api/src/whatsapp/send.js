async function sendWhatsApp(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  console.log('FROM:', JSON.stringify(process.env.TWILIO_WHATSAPP_FROM));
  console.log('TO:', JSON.stringify(to));


  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: process.env.TWILIO_WHATSAPP_FROM,
        To: to,
        Body: body,
      }),
    }
  );

  if (!res.ok) console.error('whatsapp send failed:', await res.text());
  return res.ok;
}

module.exports = { sendWhatsApp };