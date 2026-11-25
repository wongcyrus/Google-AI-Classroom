#!/usr/bin/env node
import { initializeApp } from '../functions/media_processing/node_modules/firebase-admin/lib/app/index.js';
import { getFirestore } from '../functions/media_processing/node_modules/firebase-admin/lib/firestore/index.js';

const projectId = process.argv[2] || 'it114115-2627';
const forceReloadBefore = Date.now();

initializeApp({ projectId });
const db = getFirestore();

await db.doc('system_config/clientControl').set(
  {
    forceReloadBefore,
    updatedAt: new Date(forceReloadBefore).toISOString(),
  },
  { merge: true }
);

console.log(`✅ Updated system_config/clientControl on ${projectId}: forceReloadBefore=${forceReloadBefore} (${new Date(forceReloadBefore).toISOString()})`);
process.exit(0);
