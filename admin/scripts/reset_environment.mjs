import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.argv[2] || 'it114115-dev-2026';
const isForce = process.argv.includes('--force') || process.argv.includes('-f');
const shouldDeleteUsers = process.argv.includes('--delete-users');
const shouldReseed = !process.argv.includes('--no-reseed');

console.log(`\n========================================================`);
console.log(`🧹 ENVIRONMENT RESET TOOL`);
console.log(`   Target Project: ${projectId}`);
console.log(`   Force Mode:     ${isForce ? 'YES' : 'NO'}`);
console.log(`   Delete Users:   ${shouldDeleteUsers ? 'YES' : 'NO'}`);
console.log(`   Auto-Reseed:    ${shouldReseed ? 'YES (Default)' : 'NO'}`);
console.log(`========================================================\n`);

const app = initializeApp({
  projectId: projectId,
  storageBucket: `${projectId}.firebasestorage.app`
});

const db = getFirestore();
const storage = getStorage();
const auth = getAuth();

const COLLECTIONS_TO_PURGE = [
  'classes',
  'screenshots',
  'videoJobs',
  'videoAnalysisJobs',
  'aiJobs',
  'zipJobs',
  'propertyUploadJobs',
  'studentProfiles',
  'teacherProfiles',
  'students',
  'irregularities',
  'attendance',
  'attendanceSummary',
  'progress',
  'notifications',
  'mails',
  'prompts'
];

async function resetFirestore() {
  console.log(`🔥 1. Purging Firestore Collections & Subcollections...`);
  for (const collectionName of COLLECTIONS_TO_PURGE) {
    try {
      const colRef = db.collection(collectionName);
      const snapshot = await colRef.limit(100).get();
      
      if (snapshot.empty) {
        console.log(`   • ${collectionName}: (empty, skipping)`);
        continue;
      }

      console.log(`   • Purging ${collectionName}...`);
      // Use recursiveDelete to safely and quickly clean all documents and nested subcollections
      await db.recursiveDelete(colRef);
      console.log(`     ✅ ${collectionName} purged successfully.`);
    } catch (err) {
      console.warn(`     ⚠️ Warning purging ${collectionName}:`, err.message);
    }
  }
}

async function resetStorage() {
  console.log(`\n📦 2. Purging Cloud Storage User Files...`);
  try {
    const bucket = storage.bucket();
    const [files] = await bucket.getFiles({ autoPaginate: true });
    
    // Filter to only delete application media files
    const mediaFiles = files.filter(f => 
      !f.name.startsWith('.well-known/') &&
      !f.name.startsWith('gcf-v2-') &&
      !f.name.startsWith('staging/')
    );

    if (mediaFiles.length === 0) {
      console.log(`   • Storage bucket is already clean.`);
      return;
    }

    console.log(`   • Found ${mediaFiles.length} application files to delete.`);
    const batchSize = 50;
    for (let i = 0; i < mediaFiles.length; i += batchSize) {
      const batch = mediaFiles.slice(i, i + batchSize);
      await Promise.all(batch.map(f => f.delete().catch(e => console.warn(`Could not delete ${f.name}:`, e.message))));
      console.log(`     Deleted ${Math.min(i + batchSize, mediaFiles.length)} / ${mediaFiles.length} files...`);
    }
    console.log(`   ✅ Cloud Storage cleaned.`);
  } catch (err) {
    console.warn(`   ⚠️ Warning cleaning storage:`, err.message);
  }
}

async function resetAuthUsers() {
  if (!shouldDeleteUsers) {
    console.log(`\n👥 3. Skipping User Account Deletion (pass --delete-users to wipe Auth users).`);
    return;
  }

  console.log(`\n👥 3. Purging Auth Users...`);
  try {
    let nextPageToken;
    let totalDeleted = 0;
    do {
      const listUsersResult = await auth.listUsers(100, nextPageToken);
      const uids = listUsersResult.users.map(u => u.uid);
      if (uids.length > 0) {
        const deleteResult = await auth.deleteUsers(uids);
        totalDeleted += deleteResult.successCount;
        console.log(`   • Deleted batch of ${deleteResult.successCount} users.`);
      }
      nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);
    console.log(`   ✅ Total ${totalDeleted} Auth users purged.`);
  } catch (err) {
    console.warn(`   ⚠️ Warning purging Auth users:`, err.message);
  }
}

async function reseedData() {
  if (!shouldReseed) return;
  console.log(`\n🌱 4. Re-seeding Initial Data & Prompts...`);
  try {
    const seedScript = path.join(__dirname, 'seed_initial_data.mjs');
    execSync(`node "${seedScript}" "${projectId}"`, { stdio: 'inherit' });
    console.log(`   ✅ Initial prompts and seed users restored.`);
  } catch (err) {
    console.warn(`   ⚠️ Warning during reseed:`, err.message);
  }
}

async function main() {
  const startTime = Date.now();
  await resetFirestore();
  await resetStorage();
  await resetAuthUsers();
  await reseedData();
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n========================================================`);
  console.log(`✨ ENVIRONMENT RESET COMPLETE on ${projectId} in ${duration}s!`);
  console.log(`========================================================\n`);
}

main().catch(err => {
  console.error("Fatal error during environment reset:", err);
  process.exit(1);
});
