require('dotenv').config({ path: '../.env' });
const { createSession, readSession, destroySession } = require('./src/auth/session');

(async () => {
  const sid = await createSession({
    userId: 'test-user',
    tenantId: 'eadd75ae-1946-45f7-a73b-ea2b850b8d2c',
    role: 'bursar',
  });
  console.log('created:', sid);

  console.log('read back:', await readSession(sid));

  await destroySession(sid);
  console.log('after destroy:', await readSession(sid));

  process.exit(0);
})();
