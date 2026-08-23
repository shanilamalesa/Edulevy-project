require('dotenv').config({ path: '../.env' });
const argon2 = require('argon2');
const { withTenant } = require('./src/db/withTenant');

const TENANT = 'eadd75ae-1946-45f7-a73b-ea2b850b8d2c';

(async () => {
  const hash = await argon2.hash('test1234');
  await withTenant(TENANT, async (client) => {
    await client.query('DELETE FROM users WHERE lower(email) = lower($1)', ['mary@greenhills.ac.ke']);
    await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'bursar')`,
      [TENANT, 'mary@greenhills.ac.ke', hash]
    );
  });
  console.log('user ready');
  process.exit(0);
})();