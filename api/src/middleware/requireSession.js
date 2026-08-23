const { readSession } = require('../auth/session');

// __Host- requires HTTPS, so use a plain name in local development.
const COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-sid' : 'sid';

async function requireSession(req, res, next) {
//   console.log('cookies:', req.cookies);

  const sid = req.cookies?.[COOKIE_NAME];
  if (!sid) {
    return res.status(401).json({
      data: null,
      error: { message: 'Not authenticated', code: 'NO_SESSION' }
    });
  }

  const session = await readSession(sid);
  if (!session) {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({
      data: null,
      error: { message: 'Session expired', code: 'SESSION_EXPIRED' }
    });
  }

  req.ctx = {
    userId: session.userId,
    tenantId: session.tenantId,
    role: session.role,
  };
  next();
}

module.exports = { requireSession };