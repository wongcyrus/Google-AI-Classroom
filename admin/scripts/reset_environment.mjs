import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Strict explicit target project resolution - NEVER fallback to ambient system runner or gcloud project
const explicitProjectArg = process.argv.slice(2).find(arg => !arg.startsWith('-'));
if (!explicitProjectArg) {
  console.error('\n❌ CRITICAL ERROR: Target project must be explicitly specified.');
  console.error('   Usage: node admin/scripts/reset_environment.mjs <projectId> [--delete-users] [--no-reseed] [--force]');
  console.error('   Example: node admin/scripts/reset_environment.mjs it114115-dev-2026 --delete-users --no-reseed\n');
  console.error('   Ambient system default projects are strictly disallowed to prevent corruption.');
  process.exit(1);
}

const projectId = explicitProjectArg.trim();

// 2. Prevent targeting runner / CI / default system projects
const BLOCKED_PATTERNS = ['pytest', 'runner', 'default', 'cloudbuild'];
if (BLOCKED_PATTERNS.some(pattern => projectId.toLowerCase().includes(pattern))) {
  console.error(`\n🛑 SECURITY BLOCKED: Target project '${projectId}' matches a protected system/runner project!`);
  console.error('   Aborting immediately to prevent environment corruption.\n');
  process.exit(1);
}

// 3. Prevent accidental production wipe without explicit flag
const isProduction = projectId === 'it114115-2627' || (!projectId.includes('dev') && !projectId.includes('test'));
const hasProductionOverride = process.argv.includes('--force-production-wipe');
if (isProduction && !hasProductionOverride) {
  console.error(`\n🛑 SAFETY LOCK: Target project '${projectId}' is recognized as PRODUCTION.`);
  console.error('   Wiping production requires the explicit flag: --force-production-wipe\n');
  process.exit(1);
}

// 4. Sanitize ambient environment variables so Google SDKs never touch system default project
delete process.env.GCLOUD_PROJECT;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.CLOUDSDK_CORE_PROJECT;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;

const isForce = process.argv.includes('--force') || process.argv.includes('-f');
const shouldDeleteUsers = process.argv.includes('--delete-users');
const shouldReseed = !process.argv.includes('--no-reseed');

console.log(`\n========================================================`);
console.log(`🧹 ENVIRONMENT RESET TOOL`);
console.log(`   Target Project: ${projectId}`);
console.log(`   Force Mode:     ${isForce ? 'YES' : 'NO'}`);
console.log(`   Delete Users:   ${shouldDeleteUsers ? 'YES' : 'NO'}`);
console.log(`   Auto-Reseed:    ${shouldReseed ? 'YES (Default)' : 'NO'}`);
console.log(`   Quota Project:  ${process.env.GOOGLE_CLOUD_QUOTA_PROJECT}`);
console.log(`========================================================\n`);

const app = initializeApp({
  projectId: projectId,
  storageBucket: `${projectId}.firebasestorage.app`
}, `reset-app-${Date.now()}`);

const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

const COLLECTIONS_TO_PURGE = [
  'classes',
  'screenshots',
  'audios',
  'audio_audits',
  'audio_segments',
  'dossiers',
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
  try {
    const rootCollections = await db.listCollections();
    const allCollectionNames = new Set([
      ...rootCollections.map((c) => c.id),
      ...COLLECTIONS_TO_PURGE,
    ]);

    for (const collectionName of allCollectionNames) {
      try {
        const colRef = db.collection(collectionName);
        const snapshot = await colRef.limit(1).get();

        if (snapshot.empty) {
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
  } catch (err) {
    console.warn(`   ⚠️ Warning listing collections:`, err.message);
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
    let totalDeleted = 0;
    while (true) {
      // Do NOT pass pageToken when deleting in-place: deleting users shifts remaining users to the beginning.
      const listUsersResult = await auth.listUsers(100);
      if (!listUsersResult.users || listUsersResult.users.length === 0) {
        break;
      }
      const uids = listUsersResult.users.map(u => u.uid);
      const deleteResult = await auth.deleteUsers(uids);
      totalDeleted += deleteResult.successCount;
      console.log(`   • Deleted batch of ${deleteResult.successCount} users.`);
      if (deleteResult.failureCount > 0) {
        console.warn(`   ⚠️ Batch delete had ${deleteResult.failureCount} failures:`, deleteResult.errors);
        for (const err of deleteResult.errors) {
          const failedUid = uids[err.index];
          try {
            await auth.deleteUser(failedUid);
            totalDeleted++;
          } catch (singleErr) {
            console.error(`   ❌ Failed single delete for ${failedUid}:`, singleErr.message);
          }
        }
      }
    }
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
    execSync(`node "${seedScript}" "${projectId}"`, {
      stdio: 'inherit',
      env: {
        ...process.env,
        GOOGLE_CLOUD_QUOTA_PROJECT: projectId
      }
    });
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
