#!/usr/bin/env node
import { initializeApp } from '../functions/media_processing/node_modules/firebase-admin/lib/app/index.js';
import { getFirestore } from '../functions/media_processing/node_modules/firebase-admin/lib/firestore/index.js';

const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith('--mode='));
const msgArg = args.find((a) => a.startsWith('--message='));
const positionalProject = args.find((a) => !a.startsWith('--'));

const projectId = positionalProject || 'it114115-2627';
const mode = modeArg ? modeArg.split('=')[1] : 'force_idle';
const validModes = ['prompt', 'force_idle', 'force_now'];

if (!validModes.includes(mode)) {
  console.error(`❌ Invalid mode "${mode}". Use --mode=prompt|force_idle|force_now`);
  process.exit(1);
}

const message = msgArg ? msgArg.slice('--message='.length).trim() : null;
const forceReloadBefore = Date.now();

initializeApp({ projectId });
const db = getFirestore();

await db.doc('system_config/clientControl').set(
  {
    forceReloadBefore,
    mode,
    message: message || null,
    triggeredBy: 'cli-admin',
    updatedAt: new Date(forceReloadBefore).toISOString(),
  },
  { merge: true }
);

console.log(`✅ Updated system_config/clientControl on ${projectId}: mode=${mode}, forceReloadBefore=${forceReloadBefore} (${new Date(forceReloadBefore).toISOString()})`);
process.exit(0);
