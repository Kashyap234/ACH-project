// backend/database/migrate-to-supabase.js
// One-time migration: reads local ach_db.json and uploads all data to Supabase
// Run once: node database/migrate-to-supabase.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');
const { getSupabase } = require('./supabase');

const DB_FILE = path.join(__dirname, '..', 'database', 'data', 'ach_db.json');

// Tables that need index-based keys (no natural unique key)
const INDEX_KEYED = new Set(['audit_logs', 'human_decisions', 'review_decisions', 'batch_jobs', 'acl_filter_rules', 'check_register']);

// Determine the natural key for a document
function getNaturalKey(collName, doc, idx) {
  if (INDEX_KEYED.has(collName)) return `${collName}-${idx + 1}`;
  return doc.transaction_id || doc.user_id || doc.account_id
    || doc.job_id || doc.rule_code || doc.code || doc.pattern_hash
    || `${collName}-${idx + 1}`;
}

// Strip undefined values
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function migrate() {
  console.log('\n🚀 Supabase Migration Tool — ACH Triage System');
  console.log('═══════════════════════════════════════════════\n');

  if (!fs.existsSync(DB_FILE)) {
    console.log('⚠️  No ach_db.json found. Nothing to migrate.');
    console.log('The seed.js will populate the risk_rules and return_codes on first server start.');
    process.exit(0);
  }

  const sb   = getSupabase();
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

  const collections = Object.keys(data);
  let totalWritten = 0;

  for (const collName of collections) {
    const docs = data[collName];
    if (!Array.isArray(docs) || docs.length === 0) {
      console.log(`  ⏭️  Skipped: ${collName} (empty)`);
      continue;
    }

    console.log(`  📦 Migrating: ${collName} (${docs.length} records)...`);

    // Build upsert rows
    const rows = docs.map((doc, idx) => {
      const docKey = String(getNaturalKey(collName, doc, idx));
      const now    = doc.created_at || new Date().toISOString();
      return {
        _doc_key:   docKey,
        data:       clean(doc),
        created_at: now,
        updated_at: doc.updated_at || now,
      };
    });

    // Upsert in chunks of 100 (Supabase limit per request)
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await sb
        .from(collName)
        .upsert(chunk, { onConflict: '_doc_key' });

      if (error) {
        console.error(`  ❌ Error in ${collName} (chunk ${i / CHUNK + 1}):`, error.message);
        console.error('     Make sure you ran setup.sql in the Supabase SQL Editor first!');
        process.exit(1);
      }
      totalWritten += chunk.length;
    }

    console.log(`  ✅ ${collName}: ${docs.length} records migrated`);
  }

  console.log(`\n✅ Migration complete — ${totalWritten} total records written to Supabase`);
  console.log('Your data is now in Supabase. The ach_db.json can be kept as a backup.\n');
  process.exit(0);
}

migrate().catch(e => {
  console.error('\n❌ Migration failed:', e.message);
  process.exit(1);
});
