// Africa's Talking SMS. Used for payment links, since a card URL cannot
// be typed from a feature phone, and for payment confirmations.
async function sendSMS(to, message) {
  const res = await fetch('https://api.sandbox.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      apiKey: process.env.AT_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      username: process.env.AT_USERNAME || 'sandbox',
      to,
      message,
    }),
  });

  const json = await res.json();
  const recipient = json?.SMSMessageData?.Recipients?.[0];

  if (!recipient || recipient.status !== 'Success') {
    console.error('sms failed:', JSON.stringify(json));
    return false;
  }
  return true;
}

module.exports = { sendSMS };