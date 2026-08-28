#!/usr/bin/env node

/**
 * CLI Tool: Batch Import Users to Firebase Auth & Firestore
 * 
 * Usage Examples:
 *   # 1. Import from CSV file (with columns: email, role, displayName, password, classId):
 *   node admin/scripts/import_users.mjs --file=./students.csv
 * 
 *   # 2. Batch import student list into a specific class:
 *   node admin/scripts/import_users.mjs --emails="s1@stu.vtc.edu.hk,s2@stu.vtc.edu.hk" --role=student --classId=IT114115-Demo
 * 
 *   # 3. Create teacher accounts with custom default password:
 *   node admin/scripts/import_users.mjs --file=./teachers.csv --role=teacher --password="SecurePass2026!"
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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

// Helper to parse CLI args
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

// Simple CSV parser supporting quotes & various delimiters
function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
    if (rawCols.length === 0 || !rawCols[0]) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = rawCols[idx] || '';
    });

    // Support flexible header names
    const email = row.email || row.studentemail || row.teacheremail || row['student email'] || row['user email'] || rawCols[0];
    const role = row.role || row.userrole || '';
    const displayName = row.displayname || row.name || row['display name'] || row.studentname || '';
    const password = row.password || '';
    const classId = row.classid || row.class || row['class id'] || '';

    if (email && email.includes('@')) {
      rows.push({ email: email.toLowerCase(), role, displayName, password, classId });
    }
  }
  return rows;
}

async function importSingleUser({ email, role = 'student', displayName = '', password = 'Password123!', classId = '' }) {
  const finalRole = (role || 'student').toLowerCase();
  const finalPassword = password || 'Password123!';
  const finalName = displayName || email.split('@')[0];

  let userRecord;
  let isNew = false;

  try {
    userRecord = await auth.getUserByEmail(email);
    console.log(`  ℹ️ Existing user found: ${email} (${userRecord.uid})`);
    await auth.setCustomUserClaims(userRecord.uid, { role: finalRole });
    await auth.updateUser(userRecord.uid, {
      displayName: finalName,
      emailVerified: true
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      userRecord = await auth.createUser({
        email,
        password: finalPassword,
        displayName: finalName,
        emailVerified: true
      });
      await auth.setCustomUserClaims(userRecord.uid, { role: finalRole });
      isNew = true;
      console.log(`  ✨ Created new user: ${email} (${userRecord.uid}) [Role: ${finalRole}]`);
    } else {
      throw err;
    }
  }

  // Update Firestore user profile
  const profileCollection = finalRole === 'teacher' ? 'teacherProfiles' : 'studentProfiles';
  const profileRef = db.collection(profileCollection).doc(userRecord.uid);
  const profileSnap = await profileRef.get();

  let existingClasses = [];
  if (profileSnap.exists) {
    existingClasses = profileSnap.data().classes || [];
  }

  if (classId && !existingClasses.includes(classId)) {
    existingClasses.push(classId);
  }

  await profileRef.set({
    email,
    name: finalName,
    role: finalRole,
    classes: existingClasses,
    lastUpdated: FieldValue.serverTimestamp()
  }, { merge: true });

  // If classId specified, ensure enrollment on class document
  if (classId) {
    const classRef = db.collection('classes').doc(classId);
    const classSnap = await classRef.get();

    if (classSnap.exists) {
      if (finalRole === 'teacher') {
        await classRef.update({
          teacherEmails: FieldValue.arrayUnion(email),
          teachers: FieldValue.arrayUnion(userRecord.uid)
        });
      } else {
        await classRef.update({
          studentEmails: FieldValue.arrayUnion(email),
          students: FieldValue.arrayUnion(userRecord.uid)
        });
      }
      console.log(`    ↳ Enrolled in class: ${classId}`);
    } else {
      console.warn(`    ⚠️ Warning: Class ${classId} does not exist in Firestore yet.`);
    }
  }

  return { uid: userRecord.uid, email, role: finalRole, isNew };
}

async function main() {
  const args = parseArgs();
  console.log(`\n==========================================================`);
  console.log(`📥 Batch User Importer for Project: ${projectId}`);
  console.log(`==========================================================\n`);

  let userList = [];

  if (args.file) {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Error: File not found: ${filePath}`);
      process.exit(1);
    }
    console.log(`📄 Reading CSV file: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    userList = parseCSV(content);

    // Apply CLI overrides if specified
    if (args.role) userList.forEach(u => { if (!u.role) u.role = args.role; });
    if (args.classId) userList.forEach(u => { if (!u.classId) u.classId = args.classId; });
    if (args.password) userList.forEach(u => { if (!u.password) u.password = args.password; });
  } else if (args.emails) {
    const defaultRole = args.role || 'student';
    const defaultClass = args.classId || '';
    const defaultPass = args.password || 'Password123!';

    const rawEmails = args.emails.split(/[\n,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    userList = rawEmails.map(email => ({
      email,
      role: defaultRole,
      displayName: email.split('@')[0],
      password: defaultPass,
      classId: defaultClass
    }));
  } else {
    console.log(`Usage:
  node admin/scripts/import_users.mjs --file=<path_to_csv> [--role=student|teacher] [--classId=<classId>] [--password=<pass>]
  node admin/scripts/import_users.mjs --emails="email1,email2" [--role=student|teacher] [--classId=<classId>]

CSV Format Expected:
  email,role,displayName,password,classId
  student1@stu.vtc.edu.hk,student,Alice,Password123!,IT114115-Demo
`);
    process.exit(0);
  }

  if (userList.length === 0) {
    console.log('⚠️ No valid users found to import.');
    process.exit(0);
  }

  console.log(`🚀 Starting batch import of ${userList.length} user(s)...\n`);

  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;

  for (const user of userList) {
    try {
      const res = await importSingleUser(user);
      if (res.isNew) createdCount++;
      else updatedCount++;
    } catch (err) {
      console.error(`  ❌ Failed to import ${user.email}:`, err.message);
      failedCount++;
    }
  }

  console.log(`\n==========================================================`);
  console.log(`✅ Batch Import Complete!`);
  console.log(`   • Total:   ${userList.length}`);
  console.log(`   • Created: ${createdCount}`);
  console.log(`   • Updated: ${updatedCount}`);
  console.log(`   • Failed:  ${failedCount}`);
  console.log(`==========================================================\n`);
}

main().catch(err => {
  console.error('Fatal error during batch import:', err);
  process.exit(1);
});
