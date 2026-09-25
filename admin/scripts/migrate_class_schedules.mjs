#!/usr/bin/env node

/**
 * Migration Script: Migrate Class Schedules & Initialize scheduleHistory
 * 
 * Safely audits and migrates classes in Firestore to support schedule segments (scheduleHistory).
 * Always takes a full JSON backup of the classes and their subcollections prior to executing changes.
 * 
 * Usage:
 *   node admin/scripts/migrate_class_schedules.mjs --project=it114115-dev-2026 --dry-run
 *   node admin/scripts/migrate_class_schedules.mjs --project=it114115-dev-2026
 *   node admin/scripts/migrate_class_schedules.mjs --project=it114115-2627 --dry-run
 *   node admin/scripts/migrate_class_schedules.mjs --project=it114115-2627
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CLI Arguments
function parseArgs() {
  const args = {
    dryRun: false,
    backupOnly: false,
    project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026',
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--backup-only') {
      args.backupOnly = true;
    } else if (arg.startsWith('--project=')) {
      args.project = arg.split('=')[1].trim();
    }
  }
  return args;
}

const args = parseArgs();
const projectId = args.project;

console.log('='.repeat(70));
console.log(` CLASS SCHEDULE MIGRATION & AUDIT TOOL`);
console.log(` Project Target : ${projectId}`);
console.log(` Mode           : ${args.dryRun ? 'DRY-RUN (Simulated)' : args.backupOnly ? 'BACKUP-ONLY' : 'LIVE EXECUTION'}`);
console.log('='.repeat(70));

// Initialize Firebase Admin
try {
  initializeApp({ projectId });
} catch (e) {
  // Already initialized
}

const db = getFirestore();

async function runMigration() {
  const classesCol = db.collection('classes');
  const snapshot = await classesCol.get();

  if (snapshot.empty) {
    console.log(`[!] No classes found in project "${projectId}". Exiting.`);
    return;
  }

  console.log(`\n[*] Found ${snapshot.size} classes in Firestore.`);

  // 1. Pre-flight Backup
  const backupData = [];
  const backupDir = path.resolve(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`\n[*] Creating pre-flight backup...`);
  for (const classDoc of snapshot.docs) {
    const data = classDoc.data();
    const classId = classDoc.id;

    // Fetch subcollections (e.g. lessons, attendance)
    const subcollections = {};
    try {
      const subCols = await classDoc.ref.listCollections();
      for (const subCol of subCols) {
        const subSnap = await subCol.get();
        subcollections[subCol.id] = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    } catch (subErr) {
      // listCollections might not be supported in some emulator setups; ignore if empty
    }

    backupData.push({
      classId,
      data,
      subcollections,
    });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `classes_backup_${projectId}_${timestamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`[✓] Pre-flight backup saved to: ${backupFile} (${(fs.statSync(backupFile).size / 1024).toFixed(2)} KB)`);

  if (args.backupOnly) {
    console.log(`\n[✓] Backup-only completed successfully.`);
    return;
  }

  // 2. Class Audit & Migration Preparation
  console.log(`\n[*] Auditing class schedules and scheduleHistory...`);
  const batch = db.batch();
  let updateCount = 0;
  const summaryReport = [];

  for (const classDoc of snapshot.docs) {
    const classId = classDoc.id;
    const data = classDoc.data();
    const hasHistory = Array.isArray(data.scheduleHistory);
    const historyCount = hasHistory ? data.scheduleHistory.length : 0;
    const activeSchedule = data.schedule || {};
    const slotsCount = Array.isArray(activeSchedule.timeSlots) ? activeSchedule.timeSlots.length : 0;

    let actionRequired = false;
    const updates = {};

    if (!hasHistory) {
      actionRequired = true;
      updates.scheduleHistory = [];
    }

    summaryReport.push({
      classId,
      name: data.name || classId,
      activeStart: activeSchedule.startDate || 'NONE',
      activeEnd: activeSchedule.endDate || 'NONE',
      timeSlots: slotsCount,
      historySegments: historyCount,
      needsMigration: actionRequired,
    });

    if (actionRequired) {
      updateCount++;
      batch.update(classDoc.ref, updates);
    }
  }

  // Print Summary Table
  console.log('\nAudit Summary:');
  console.table(summaryReport);

  console.log(`\nClasses requiring scheduleHistory initialization: ${updateCount} of ${snapshot.size}`);

  if (updateCount === 0) {
    console.log(`[✓] All classes already have valid scheduleHistory initialized. No modifications needed.`);
    return;
  }

  // 3. Execution
  if (args.dryRun) {
    console.log(`\n[DRY-RUN] No changes were written to Firestore. Re-run without --dry-run to commit.`);
  } else {
    console.log(`\n[*] Committing batch updates to Firestore...`);
    await batch.commit();
    console.log(`[✓] Successfully updated ${updateCount} classes in project "${projectId}".`);
  }
}

runMigration().catch(err => {
  console.error('\n[FATAL] Migration failed:', err);
  process.exit(1);
});
