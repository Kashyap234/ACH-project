// backend/server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { seed } = require('./database/seed');
const { initGemini } = require('./services/aiTriage');
const authRouter           = require('./routes/auth');
const transactionsRouter    = require('./routes/transactions');
const analyticsRouter       = require('./routes/analytics');
const bulkRouter            = require('./routes/bulk');
const accountsRouter        = require('./routes/accounts');
const positivePayRouter     = require('./routes/positivePayRegister');
const exceptionsRouter      = require('./routes/exceptions');
const chatbotRouter         = require('./routes/chatbot');
const infoRequestsRouter    = require('./routes/infoRequests');    // MIR + autonomous workflow

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ 
  origin: [
    process.env.FRONTEND_URL, 
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173'
  ].filter(Boolean) 
}));
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    const c = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
    console.log(`${c}${req.method} ${req.path} ${res.statusCode} (${Date.now()-t}ms)\x1b[0m`);
  });
  next();
});

// MIR routes mounted BEFORE transactionsRouter — specific paths must win over /:id catch-all
// POST /api/transactions/:id/request-info
// GET  /api/transactions/:id/info-requests
// POST /api/transactions/:id/override-ai
// GET  /api/portal/:token
// POST /api/portal/:token/respond
app.use('/api',              infoRequestsRouter);

app.use('/api/auth',         authRouter);
app.use('/api/transactions',   transactionsRouter);
app.use('/api/analytics',      analyticsRouter);
app.use('/api/bulk',           bulkRouter);
app.use('/api/accounts',       accountsRouter);
app.use('/api/check-register', positivePayRouter);
app.use('/api/exceptions',     exceptionsRouter);
app.use('/api/chatbot',        chatbotRouter);

app.get('/api/health', (req, res) => res.json({
  status: 'ok', service: 'ACH AI Triage System v3.0', version: '3.0.0',
  timestamp: new Date().toISOString(),
  features: ['full_nacha_fields','bulk_processing','rich_learning','positive_pay_register','account_filters','exception_dashboard','reverse_positive_pay','dual_control'],
  gemini: process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY' ? 'connected' : 'simulation_mode'
}));

app.use((req, res) => res.status(404).json({ success:false, error:`${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ success:false, error: err.message }); });

async function bootstrap() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🏦 ACH Payment & Positive Pay AI Triage System v3.0');
  console.log('     Full NACHA · Bulk · Rich Learning · Positive Pay Register');
  console.log('     Account Filters · Exception Dashboard · Reverse Positive Pay');
  console.log('═══════════════════════════════════════════════════════════════');
  await seed();
  initGemini();
  app.listen(PORT, () => {
    console.log(`\n🚀 API at http://localhost:${PORT}`);
    console.log(`📋 Exceptions: http://localhost:${PORT}/api/exceptions`);
    console.log(`🏦 Accounts:   http://localhost:${PORT}/api/accounts`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Self-ping to prevent Render from sleeping on the free tier (every 2.5 minutes)
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderUrl) {
      console.log(`[Heartbeat] Started self-ping for ${renderUrl} every 2.5 mins`);
      setInterval(() => {
        const httpLib = renderUrl.startsWith('https') ? require('https') : require('http');
        httpLib.get(`${renderUrl}/api/health`).on('error', (err) => {
          console.error('[Heartbeat] Self-ping failed:', err.message);
        });
      }, 150000); // 150,000 ms = 2.5 minutes
    }
  });
}

bootstrap();