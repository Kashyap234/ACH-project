require('dotenv').config();
const { getSupabase } = require('./database/supabase');

const tables = [
  'transactions',
  'risk_rules',
  'return_codes',
  'audit_logs',
  'human_decisions',
  'review_decisions',
  'learning_patterns',
  'batch_jobs',
  'accounts',
  'acl_filter_rules',
  'check_register',
  'info_requests',
  'transaction_lifecycles',
  'chat_sessions',
  'chat_messages'
];

async function deleteSupabaseData() {
  try {
    const sb = getSupabase();
    console.log('Starting data deletion...');
    for (const table of tables) {
      console.log(`Deleting all records from: ${table}`);
      const { error } = await sb.from(table).delete().neq('_id', -1);
      if (error) {
        console.error(`Error deleting from ${table}:`, error);
      } else {
        console.log(`Successfully deleted from ${table}`);
      }
    }
    console.log('Skipping users table.');
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Script error:', err);
    process.exit(1);
  }
}

deleteSupabaseData();
