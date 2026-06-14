// backend/database/supabase.js — Supabase client initialization
const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getSupabase() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY; // Service role key — bypasses RLS

  if (!url || !key) {
    throw new Error(
      '[Supabase] Missing credentials.\n' +
      'Set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file.\n' +
      'Find them in: Supabase Console → Project Settings → API'
    );
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  });

  console.log('[Supabase] ✅ Client initialized');
  return _client;
}

module.exports = { getSupabase };
