// backend/database/firebase.js — Firebase Admin SDK initialization (v14+ compatible)
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore: _getFirestore }   = require('firebase-admin/firestore');
const path = require('path');
const fs   = require('fs');

let _db = null;

function getFirestore() {
  if (_db) return _db;

  let serviceAccount;
  let saPath;

  if (getApps().length === 0) {
    saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
      : path.join(__dirname, '..', 'firebase-service-account.json');

    if (!fs.existsSync(saPath)) {
      throw new Error(
        `[Firebase] Service account file not found at: ${saPath}\n` +
        `Set FIREBASE_SERVICE_ACCOUNT_PATH in .env or place firebase-service-account.json in the backend root.`
      );
    }

    serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));

    initializeApp({
      credential: cert(serviceAccount),
      projectId:  serviceAccount.project_id,
    });

    console.log(`[Firebase] ✅ Initialized — project: ${serviceAccount.project_id}`);
  }

  // Get the database ID from env (Firebase Console URL shows /databases/default/)
  const databaseId = process.env.FIREBASE_DATABASE_ID || '(default)';

  // Use the app instance to get a specific database
  const app = getApps()[0];
  _db = _getFirestore(app, databaseId);

  // ignoreUndefinedProperties prevents errors when JS objects have undefined values
  _db.settings({ ignoreUndefinedProperties: true });

  return _db;
}

module.exports = { getFirestore };
