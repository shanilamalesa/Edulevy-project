require('dotenv').config({ path: '../.env' });
const { stkPush } = require('./src/mpesa/daraja');

(async () => {
  const result = await stkPush({
    msisdn: '+254708374149',       // Safaricom's sandbox test number
    amountMinor: 100000,
    reference: 'ADM-001',
    description: 'School fees',
  });
  console.log(result);
  process.exit(0);
})();