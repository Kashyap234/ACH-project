require('dotenv').config();
const { getFirestore } = require('./database/firebase');

async function deleteCollection(db, collectionPath, batchSize) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(db, query, resolve) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}

async function run() {
  try {
    const db = getFirestore();
    const collections = await db.listCollections();
    
    console.log('Collections found:');
    for (const collection of collections) {
      console.log(`- ${collection.id}`);
      if (collection.id !== 'users') {
        console.log(`Deleting documents in collection: ${collection.id}`);
        await deleteCollection(db, collection.id, 500);
        console.log(`Deleted collection: ${collection.id}`);
      } else {
        console.log(`Skipping collection: ${collection.id}`);
      }
    }
    console.log('Done.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

run();
