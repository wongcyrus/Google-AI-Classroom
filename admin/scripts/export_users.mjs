#!/usr/bin/env node

/**
 * CLI Tool: Export Users from Firebase Auth & Firestore to CSV
 * 
 * Usage Examples:
 *   # 1. Export all users to a CSV file:
 *   node admin/scripts/export_users.mjs --file=./all_users.csv
 * 
 *   # 2. Export only students:
 *   node admin/scripts/export_users.mjs --role=student --file=./students.csv
 * 
 *   # 3. Export only users enrolled in a specific class:
 *   node admin/scripts/export_users.mjs --classId=IT114115-Demo --file=./demo_roster.csv
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026';

try {
  initializeApp({ projectId });
} catch (e) {
  // Already initialized
}

const auth = getAuth();
const db = getFirestore();

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...vals] = arg.slice(2).split('=');
      args[key] = vals.join('=') || true;
    }
  }
  return args;
}

// Convert data to CSV format
function toCSV(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map(h => {
      let val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    csvLines.push(values.join(','));
  }
  return csvLines.join('\n');
}

async function fetchAllAuthUsers() {
  const users = [];
  let nextPageToken;
  do {
    const result = await auth.listUsers(1000, nextPageToken);
    users.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);
  return users;
}

async function main() {
  const args = parseArgs();
  console.log(`\n==========================================================`);
  console.log(`📤 User Exporter for Project: ${projectId}`);
  console.log(`==========================================================\n`);

  console.log('🔍 Fetching Auth users and Firestore profiles...');
  const authUsers = await fetchAllAuthUsers();

  // Load profiles from Firestore
  const studentProfilesSnap = await db.collection('studentProfiles').get();
  const teacherProfilesSnap = await db.collection('teacherProfiles').get();

  const profileMap = new Map();
  studentProfilesSnap.forEach(doc => profileMap.set(doc.id, { ...doc.data(), collectionRole: 'student' }));
  teacherProfilesSnap.forEach(doc => profileMap.set(doc.id, { ...doc.data(), collectionRole: 'teacher' }));

  let rows = [];

  for (const u of authUsers) {
    const profile = profileMap.get(u.uid) || {};
    const role = (u.customClaims?.role || profile.role || profile.collectionRole || 'student').toLowerCase();
    const enrolledClasses = (profile.classes || []).join('; ');
    const displayName = u.displayName || profile.name || '';

    // Filter by role if requested
    if (args.role && args.role.toLowerCase() !== 'all' && role !== args.role.toLowerCase()) {
      continue;
    }

    // Filter by classId if requested
    if (args.classId && !(profile.classes || []).includes(args.classId)) {
      continue;
    }

    rows.push({
      UID: u.uid,
      Email: u.email || '',
      Role: role,
      DisplayName: displayName,
      EmailVerified: u.emailVerified ? 'Yes' : 'No',
      Disabled: u.disabled ? 'Yes' : 'No',
      EnrolledClasses: enrolledClasses,
      CreatedAt: u.metadata?.creationTime || '',
      LastSignIn: u.metadata?.lastSignInTime || ''
    });
  }

  console.log(`📊 Total matching users found: ${rows.length}`);

  const csvContent = toCSV(rows);

  if (args.file) {
    const outputPath = path.resolve(process.cwd(), args.file);
    fs.writeFileSync(outputPath, csvContent, 'utf8');
    console.log(`\n✅ Successfully exported ${rows.length} users to: ${outputPath}`);
  } else {
    console.log('\n--- CSV OUTPUT ---\n');
    console.log(csvContent);
  }
}

main().catch(err => {
  console.error('Fatal error during export:', err);
  process.exit(1);
});
