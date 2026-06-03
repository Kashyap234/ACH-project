// backend/middleware/auth.js — JWT authentication middleware
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ach-triage-super-secret-key-2024';

/**
 * authenticate — Rejects requests without a valid JWT.
 * Attaches req.user = { user_id, username, full_name, role, email }
 */
function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Session expired or invalid. Please log in again.' });
  }
}

/**
 * optionalAuth — Same as authenticate but does NOT reject unauthenticated requests.
 * If a valid token is present, req.user is set; otherwise req.user = null.
 */
function optionalAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch { req.user = null; }
  } else {
    req.user = null;
  }
  next();
}

module.exports = { authenticate, optionalAuth, JWT_SECRET };
