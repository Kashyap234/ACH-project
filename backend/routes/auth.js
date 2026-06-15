// backend/routes/auth.js — Admin-managed user creation with email notification (Firestore async)
const dns = require('dns');
// Force Node.js to prioritize IPv4 globally, fixing Render's IPv6 ENETUNREACH issues
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { insert, queryOne, queryAll, update, remove } = require('../database/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

const ROLES = ['reviewer', 'analyst', 'admin', 'supervisor'];

function signToken(user) {
  return jwt.sign(
    { user_id: user.user_id, username: user.username, full_name: user.full_name, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// ── Email sender (uses nodemailer if configured, otherwise logs to console) ───
async function sendWelcomeEmail({ to, full_name, username, password, role }) {
  const roleLabel = { admin:'Administrator', supervisor:'Supervisor', analyst:'Analyst', reviewer:'Reviewer' }[role] || role;
  const subject   = 'Your ACH Triage AI System Account Has Been Created';
  const body      = [
    'Hello ' + full_name + ',',
    '',
    'An administrator has created an account for you on the ACH Payment & Positive Pay AI Triage System.',
    '',
    'Your login credentials:',
    '  Username : ' + username,
    '  Password : ' + password,
    '  Role     : ' + roleLabel,
    '  Login URL: http://localhost:5173/login',
    '',
    'Please log in and change your password as soon as possible.',
    '',
    'This is an automated message from the ACH Triage AI System v3.0.',
  ].join('\n');

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromAddr = process.env.RESEND_FROM || 'onboarding@resend.dev'; // Resend's default testing address

  if (resendApiKey) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(resendApiKey);

      const { data, error } = await resend.emails.send({
        from: fromAddr,
        to: to,
        subject: subject,
        text: body
      });

      if (error) {
        console.warn('[Auth] ⚠️  Email send failed:', error.message);
        return { sent: false, error: error.message };
      }

      console.log('[Auth] ✅ Welcome email sent to:', to, 'ID:', data?.id);
      return { sent: true };
    } catch (e) {
      console.warn('[Auth] ⚠️  Email send failed:', e.message);
      return { sent: false, error: e.message };
    }
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  NEW USER CREDENTIALS (email not sent)   ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  To      : ' + to);
  console.log('║  Username: ' + username);
  console.log('║  Password: ' + password);
  console.log('║  Role    : ' + roleLabel);
  console.log('╚══════════════════════════════════════════╝\n');
  return { sent: false, reason: 'SMTP not configured — credentials logged to server console' };
}

function generatePassword(len = 12) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    const user = await queryOne('users', u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    if (!user.is_active) return res.status(403).json({ success: false, error: 'Account is disabled. Contact an administrator.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Invalid username or password.' });

    await update('users', u => u.user_id === user.user_id, () => ({ last_login: new Date().toISOString() }));

    const token = signToken(user);
    const { password_hash: _, ...safeUser } = user;

    await insert('audit_logs', {
      transaction_id: null, event_type: 'user_login',
      event_summary: 'User logged in: ' + user.full_name + ' (' + user.username + ')',
      event_data: { user_id: user.user_id, role: user.role },
      actor: user.username, severity: 'info'
    });

    console.log('[Auth] ✅ Login: ' + user.username + ' (' + user.role + ')');
    res.json({ success: true, message: 'Welcome back, ' + user.full_name + '!', token, user: safeUser });
  } catch (e) {
    console.error('[POST /auth/login]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await queryOne('users', u => u.user_id === req.user.user_id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    const { password_hash: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/auth/create-user — Admin only: create user + send email ─────────
router.post('/create-user', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required to create users.' });
    }

    const { username, full_name, email, role, custom_password } = req.body;

    if (!username || !full_name || !email || !role) {
      return res.status(400).json({ success: false, error: 'username, full_name, email, and role are required.' });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: 'Role must be one of: ' + ROLES.join(', ') });
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email address.' });
    }

    if (await queryOne('users', u => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ success: false, error: 'Username "' + username + '" is already taken.' });
    }
    if (await queryOne('users', u => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ success: false, error: 'Email "' + email + '" is already registered.' });
    }

    const plainPassword = custom_password || generatePassword();
    const password_hash = await bcrypt.hash(plainPassword, 12);
    const user_id = 'USR-' + uuidv4().slice(0, 8).toUpperCase();

    const user = await insert('users', {
      user_id, username: username.trim(), full_name: full_name.trim(),
      email: email.trim().toLowerCase(), password_hash, role,
      is_active: true, last_login: null,
      created_by: req.user.username,
    });

    const emailResult = await sendWelcomeEmail({
      to: email, full_name, username: username.trim(), password: plainPassword, role
    });

    await insert('audit_logs', {
      transaction_id: null, event_type: 'user_created',
      event_summary: 'User created by admin ' + req.user.username + ': ' + full_name + ' (' + username + ') — Role: ' + role,
      event_data: { user_id, role, created_by: req.user.username, email_sent: emailResult.sent },
      actor: req.user.username, severity: 'info'
    });

    const { password_hash: _, ...safeUser } = user;
    console.log('[Auth] ✅ User created by admin: ' + username + ' (' + role + ')');

    res.status(201).json({
      success: true,
      message: 'User "' + username + '" created successfully. ' + (emailResult.sent ? 'Credentials sent to ' + email + '.' : 'Credentials logged to server console (SMTP not configured).'),
      user: safeUser,
      email_status: emailResult,
      temp_password: plainPassword,
    });
  } catch (e) {
    console.error('[POST /auth/create-user]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/auth/users — Admin: list all users ───────────────────────────────
router.get('/users', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required.' });
    }
    const users = await queryAll('users', null, { orderBy: 'created_at', desc: true });
    const safe  = users.map(({ password_hash, ...u }) => u);
    res.json({ success: true, data: safe, total: safe.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PATCH /api/auth/users/:user_id — Admin: update user role / active status ──
router.patch('/users/:user_id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required.' });
    }

    const { user_id } = req.params;
    const existing = await queryOne('users', u => u.user_id === user_id);
    if (!existing) return res.status(404).json({ success: false, error: 'User not found.' });

    if (user_id === req.user.user_id && req.body.is_active === false) {
      return res.status(400).json({ success: false, error: 'You cannot deactivate your own account.' });
    }

    const allowed = {};
    if (req.body.role       !== undefined && ROLES.includes(req.body.role)) allowed.role       = req.body.role;
    if (req.body.is_active  !== undefined) allowed.is_active  = Boolean(req.body.is_active);
    if (req.body.full_name  !== undefined) allowed.full_name  = req.body.full_name;

    if (req.body.reset_password) {
      const newPass = generatePassword();
      allowed.password_hash = await bcrypt.hash(newPass, 12);
      await sendWelcomeEmail({ to: existing.email, full_name: existing.full_name, username: existing.username, password: newPass, role: allowed.role || existing.role });
      allowed._temp_password = newPass;
    }

    const tempPass = allowed._temp_password;
    delete allowed._temp_password;

    await update('users', u => u.user_id === user_id, () => allowed);

    await insert('audit_logs', {
      transaction_id: null, event_type: 'user_updated',
      event_summary: 'User updated by ' + req.user.username + ': ' + existing.username + ' — Changed: ' + Object.keys(allowed).join(', '),
      event_data: { user_id, changes: allowed, by: req.user.username },
      actor: req.user.username, severity: 'warning'
    });

    const updated = await queryOne('users', u => u.user_id === user_id);
    const { password_hash: _, ...safeUser } = updated;

    res.json({
      success: true,
      message: 'User "' + existing.username + '" updated successfully.',
      user: safeUser,
      ...(tempPass ? { temp_password: tempPass, note: 'New password sent to ' + existing.email } : {})
    });
  } catch (e) {
    console.error('[PATCH /auth/users/:id]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/auth/users/:user_id — Admin: permanently delete user ──────────
router.delete('/users/:user_id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required.' });
    }

    const { user_id } = req.params;
    if (user_id === req.user.user_id) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account.' });
    }

    const existing = await queryOne('users', u => u.user_id === user_id);
    if (!existing) return res.status(404).json({ success: false, error: 'User not found.' });

    await remove('users', u => u.user_id === user_id);

    await insert('audit_logs', {
      transaction_id: null, event_type: 'user_deleted',
      event_summary: 'User DELETED by ' + req.user.username + ': ' + existing.full_name + ' (' + existing.username + ')',
      event_data: { user_id, deleted_username: existing.username, role: existing.role },
      actor: req.user.username, severity: 'critical'
    });

    res.json({ success: true, message: 'User "' + existing.username + '" has been permanently deleted.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/auth/change-password — Any user: change own password ─────────────
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'current_password and new_password are required.' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });
    }

    const user = await queryOne('users', u => u.user_id === req.user.user_id);
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Current password is incorrect.' });

    const password_hash = await bcrypt.hash(new_password, 12);
    await update('users', u => u.user_id === req.user.user_id, () => ({ password_hash }));

    await insert('audit_logs', {
      transaction_id: null, event_type: 'password_changed',
      event_summary: 'Password changed by ' + user.username,
      event_data: { user_id: user.user_id }, actor: user.username, severity: 'info'
    });

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = Object.assign(router, { sendWelcomeEmail });
