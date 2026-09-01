const express = require('express');
const argon2 = require('argon2'); //for password hashing and verification
const { pool } = require('../db/pool');
const { withTenant } = require('../db/withTenant');
const { createSession, destroySession } = require('../auth/session');
const { requireSession } = require('../middleware/requireSession');

const router = express.Router();

// __Host- requires HTTPS, so use a plain name in local development.
const COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-sid' : 'sid';

// A real Argon2 hash of a random string. Verified against on user-miss so
// the response timing does not reveal whether an account exists.
const DUMMY_HASH = '$argon2id$v=19$m=65536,p=4,t=3$+6ePdbFFiStWxuMOt/1K0g$SGfQnJE1WwDbfz01ynu+cmB0p1/1IoIGo2bnYYEXLbI';

router.post('/login', async (req, res) => {
  const { email, password, tenantSlug } = req.body || {};

  if (!email || !password || !tenantSlug) {
    return res.status(400).json({
      data: null,
      error: { message: 'email, password and tenantSlug are required', code: 'BAD_REQUEST' }
    });
  }

  // tenants has no RLS, so this lookup runs outside withTenant()
  //finds the school which someone has logged in
  const tenantResults = await pool.query(
    'SELECT id, name FROM tenants WHERE slug = $1 AND deleted_at IS NULL',
    [tenantSlug]
  );
  const tenant = tenantResults.rows[0];

  // The tenant_id filter, and find the user only if the school was found first
  
  const userResults = tenant
    ? await withTenant(tenant.id, (client) =>
        client.query(
            'SELECT id, email, password_hash, role, status FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL',
            [email]
        )
    )
    //if no return an empty results
        : { rows: [] };
    const user = userResults.rows[0];

    ////verify the password
  const valid = user
    ? await argon2.verify(user.password_hash, password)
    : await argon2.verify(DUMMY_HASH, password).catch(() => false);


  if (!user || !valid) {
    return res.status(401).json({
      data: null,
      error: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }
    });
  }

    // A pending or deactivated account gets the same response as a wrong
  // password. Saying "awaiting approval" would confirm the email exists.
  if (user.status !== 'active') {
    return res.status(401).json({
      data: null,
      error: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }
    });
  }

  //create the session 
  const sid = await createSession({
    userId: user.id,
    tenantId: tenant.id,
    role: user.role,
  });

  
  //sets the session cookie 
  
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 1800 * 1000,
  });

  //send the response back to the browser
  return res.json({
    data: {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant: { id: tenant.id, name: tenant.name },
    },
    error: null,
  });
});

//delete the session from redis, when someone  logs out
router.post('/logout', requireSession, async (req, res) => {
  await destroySession(req.cookies[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME);
  return res.status(204).send();
});

router.get('/me', requireSession, async (req, res) => {
  const tenant = await pool.query(
    'SELECT name FROM tenants WHERE id = $1',
    [req.ctx.tenantId]
  );
  return res.json({
    data: { ...req.ctx, tenantName: tenant.rows[0]?.name },
    error: null,
  });
});


// Public: anyone can request an account, but it is useless until a manager
// approves it. The school code scopes the request to one tenant.
router.post('/register', async (req, res) => {
  console.log('register attempt', req.body);
  const { email, password, tenantSlug, role } = req.body || {};

  if (!email || !password || !tenantSlug) {
    return res.status(400).json({
      data: null,
      error: { message: 'email, password and tenantSlug are required', code: 'BAD_REQUEST' }
    });
  }
  if (password.length < 8) {
    return res.status(400).json({
      data: null,
      error: { message: 'Password must be at least 8 characters', code: 'WEAK_PASSWORD' }
    });
  }

  const t = await pool.query(
    'SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL',
    [tenantSlug]
  );
  const tenant = t.rows[0];
  console.log('tenant found:', tenant?.id ||'NONE');

  // The same reply whether or not the school exists, and whether or not
  // the email is already taken — otherwise this endpoint would let anyone
  // discover which schools and which staff exist.
  const accepted = {
    data: { message: 'Request submitted. A manager will review it.' },
    error: null,
  };

  if (!tenant) return res.status(202).json(accepted);

  try {
    const hash = await argon2.hash(password);
    await withTenant(tenant.id, (client) =>
      client.query(
        `INSERT INTO users (tenant_id, email, password_hash, role, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [tenant.id, email.trim(), hash, role === 'manager' ? 'manager' : 'bursar']
      )
    );
  } catch (err) {
    if (err.code !== '23505') throw err;
  }

  return res.status(202).json(accepted);
});

module.exports = router;