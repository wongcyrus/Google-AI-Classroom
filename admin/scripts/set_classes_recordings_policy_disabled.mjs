#!/usr/bin/env node

/**
 * Script: Ensure all existing classes are set to NOT share student screen recordings back to students.
 * Sets studentRecordingsPolicy: 'disabled' on all classes in Firestore.
 * 
 * Usage:
 *   node admin/scripts/set_classes_recordings_policy_disabled.mjs --project=it114115-2627
 *   node admin/scripts/set_classes_recordings_policy_disabled.mjs --project=it114115-dev-2026
 *   node admin/scripts/set_classes_recordings_policy_disabled.mjs --dry-run
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function parseArgs() {
  const args = {
    dryRun: false,
    project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-2627',
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg.startsWith('--project=')) {
      args.project = arg.split('=')[1].trim();
    }
  }
  return args;
}

const args = parseArgs();
const projectId = args.project;

console.log('='.repeat(70));
console.log(` SET STUDENT RECORDINGS POLICY TO DISABLED (DO NOT SHARE)`);
console.log(` Target Project : ${projectId}`);
console.log(` Mode           : ${args.dryRun ? 'DRY-RUN (Simulated)' : 'LIVE EXECUTION'}`);
console.log('='.repeat(70));

const app = initializeApp({ projectId }, `app-${Date.now()}`);
const db = getFirestore(app);

async function run() {
  const classesCol = db.collection('classes');
  const snapshot = await classesCol.get();

  if (snapshot.empty) {
    console.log(`[!] No classes found in project "${projectId}".`);
    return;
  }

  console.log(`Found ${snapshot.docs.length} class(es) in "${projectId}". Processing...\n`);

  let updatedCount = 0;
  let alreadyDisabledCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const currentPolicy = data.studentRecordingsPolicy;
    const name = data.name || doc.id;

    if (currentPolicy === 'disabled') {
      console.log(`[✓] Class "${name}" (${doc.id}): Already set to 'disabled'.`);
      alreadyDisabledCount++;
      continue;
    }

    console.log(`[⚡] Updating Class "${name}" (${doc.id}): previous policy "${currentPolicy || 'undefined'}" -> 'disabled'`);

    if (!args.dryRun) {
      await doc.ref.update({
        studentRecordingsPolicy: 'disabled',
        updatedAt: new Date(),
      });
    }
    updatedCount++;
  }

  console.log('\n' + '='.repeat(70));
  console.log(` SUMMARY for project ${projectId}:`);
  console.log(` Total Classes Checked  : ${snapshot.docs.length}`);
  console.log(` Already 'disabled'     : ${alreadyDisabledCount}`);
  console.log(` Updated to 'disabled'  : ${updatedCount} ${args.dryRun ? '(simulated)' : ''}`);
  console.log('='.repeat(70));
}

run().catch((err) => {
  console.error('Fatal error running migration:', err);
  process.exit(1);
});
