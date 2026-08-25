//turns a cookie into an identity or stops the request

const { readSession } = require('../auth/session');

// __Host- requires HTTPS, so use a plain name in local development.
const COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-sid' : 'sid';
// let COOKIE_NAME;
// if (process.env.NODE_ENV === 'production') {
//   COOKIE_NAME = '__Host-sid';
// } else {
//   COOKIE_NAME = 'sid';
// }


//checks wheather the cookie was sent
async function requireSession(req, res, next) {
//   console.log('cookies:', req.cookies);

  const sid = req.cookies?.[COOKIE_NAME];
  if (!sid) {
    //retrun 401-unauthorised, 
    return res.status(401).json({
      data: null,
      error: { message: 'Not authenticated', code: 'NO_SESSION' }
    });
  }

  //checks wheather the cookie still means anything
  const session = await readSession(sid);
  if (!session) {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({
      data: null,
      error: { message: 'Session expired', code: 'SESSION_EXPIRED' }
    });
  }

  //adding & creating a new property to he request object
  req.ctx = {
    userId: session.userId,
    tenantId: session.tenantId,
    role: session.role,
  };
  //continue running the route
  next();
}

module.exports = { requireSession };