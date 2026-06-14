// backend/database/migrate-to-firebase.js
// One-time script: reads local ach_db.json and uploads all data to Firestore
// Run once: node database/migrate-to-firebase.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');
const { getFirestore } = require('./firebase');

const DB_FILE = path.join(__dirname, 'data', 'ach_db.json');

async function migrate() {
  console.log('\n🔥 Firebase Migration Tool — ACH Triage System');
  console.log('═══════════════════════════════════════════════\n');

  if (!fs.existsSync(DB_FILE)) {
    console.log('⚠️  No ach_db.json found. Nothing to migrate.');
    process.exit(0);
  }

  const db   = getFirestore();
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

  const collections = Object.keys(data);
  let totalWritten = 0;

  for (const collName of collections) {
    const rows = data[collName];
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`  ⏭️  Skipped: ${collName} (empty)`);
      continue;
    }

    console.log(`  📦 Migrating: ${collName} (${rows.length} records)...`);

    // Write in batches of 400 (Firestore batch limit is 500)
    const BATCH_SIZE = 400;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const row of chunk) {
        // Strip undefined values
        const clean = {};
        for (const [k, v] of Object.entries(row)) {
          if (v !== undefined) clean[k] = v;
        }

        // Determine doc ID from natural key fields
        const naturalKey = clean.transaction_id || clean.user_id || clean.account_id
          || clean.job_id || clean.rule_code || clean.code || clean.pattern_hash;
        const ref = naturalKey
          ? db.collection(collName).doc(String(naturalKey))
          : db.collection(collName).doc();

        batch.set(ref, clean, { merge: true });
      }

      await batch.commit();
      totalWritten += chunk.length;
    }

    console.log(`  ✅ ${collName}: ${rows.length} records migrated`);
  }

  console.log(`\n✅ Migration complete — ${totalWritten} total records written to Firestore`);
  console.log('You can now delete ach_db.json or keep it as a backup.\n');
  process.exit(0);
}

migrate().catch(e => {
  console.error('\n❌ Migration failed:', e.message);
  process.exit(1);
});
