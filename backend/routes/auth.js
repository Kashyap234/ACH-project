// backend/routes/auth.js — Register, Login, Profile endpoints
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { insert, queryOne, queryAll, update } = require('../database/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

const ROLES = ['reviewer', 'analyst', 'admin', 'supervisor'];

function signToken(user) {
  return jwt.sign(
    { user_id: user.user_id, username: user.username, full_name: user.full_name, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, full_name, email, password, role = 'reviewer' } = req.body;

    // Validate required fields
    if (!username || !full_name || !email || !password) {
      return res.status(400).json({ success: false, error: 'username, full_name, email and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: `Role must be one of: ${ROLES.join(', ')}` });
    }

    // Check uniqueness
    const existingUsername = queryOne('users', u => u.username.toLowerCase() === username.toLowerCase());
    if (existingUsername) return res.status(409).json({ success: false, error: 'Username already taken.' });

    const existingEmail = queryOne('users', u => u.email.toLowerCase() === email.toLowerCase());
    if (existingEmail) return res.status(409).json({ success: false, error: 'Email already registered.' });

    const password_hash = await bcrypt.hash(password, 12);
    const user_id = `USR-${uuidv4().slice(0, 8).toUpperCase()}`;

    const user = insert('users', {
      user_id, username: username.trim(), full_name: full_name.trim(),
      email: email.trim().toLowerCase(), password_hash, role,
      is_active: true, last_login: null
    });

    const token = signToken(user);
    const { password_hash: _, ...safeUser } = user;

    insert('audit_logs', {
      transaction_id: null,
      event_type:    'user_registered',
      event_summary: `New user registered: ${full_name} (${username}) — Role: ${role}`,
      event_data:    { user_id, role },
      actor:         username,
      severity:      'info'
    });

    console.log(`[Auth] ✅ Registered: ${username} (${role})`);
    res.status(201).json({ success: true, message: 'Account created successfully.', token, user: safeUser });
  } catch (e) {
    console.error('[POST /auth/register]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    const user = queryOne('users', u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    if (!user.is_active) return res.status(403).json({ success: false, error: 'Account is disabled. Contact an administrator.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Invalid username or password.' });

    // Update last login
    update('users', u => u.user_id === user.user_id, () => ({ last_login: new Date().toISOString() }));

    const token = signToken(user);
    const { password_hash: _, ...safeUser } = user;

    insert('audit_logs', {
      transaction_id: null,
      event_type:    'user_login',
      event_summary: `User logged in: ${user.full_name} (${user.username})`,
      event_data:    { user_id: user.user_id, role: user.role },
      actor:         user.username,
      severity:      'info'
    });

    console.log(`[Auth] ✅ Login: ${user.username} (${user.role})`);
    res.json({ success: true, message: `Welcome back, ${user.full_name}!`, token, user: safeUser });
  } catch (e) {
    console.error('[POST /auth/login]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  try {
    const user = queryOne('users', u => u.user_id === req.user.user_id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    const { password_hash: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/auth/users — Admin: list all users ──────────────────────────────
router.get('/users', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required.' });
    }
    const users = queryAll('users', null, { orderBy: 'created_at', desc: true });
    const safe  = users.map(({ password_hash, ...u }) => u);
    res.json({ success: true, data: safe });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
