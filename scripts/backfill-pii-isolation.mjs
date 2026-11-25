#!/usr/bin/env node
/**
 * Idempotent Firestore PII Isolation Backfill Script
 *
 * 1. Mirrors non-PII class configuration from `classes/{classId}` into
 *    `classes/{classId}/studentConfig/public` so enrolled students never need
 *    read access to `classes/{classId}` (which contains classmate rosters/profiles).
 * 2. Mirrors `system_config/loginPolicy` passwordWhitelist / passwordWhitelistUids
 *    exemptions onto each exempted student's owner-only `studentProfiles/{uid}` doc
 *    (`passkeyPermanentExempt: true`) and clears stale `passkeyPermanentExempt: true`
 *    flags when a student is no longer on the exemption whitelist.
 *
 * Usage:
 *   node scripts/backfill-pii-isolation.mjs [projectId] [--dry-run]
 *   Default projectId: it114115-dev-2026
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectIdArg = args.find((a) => !a.startsWith('-'));
const projectId = (projectIdArg || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026').trim();

delete process.env.GCLOUD_PROJECT;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.CLOUDSDK_CORE_PROJECT;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;

export const PUBLIC_STUDENT_CONFIG_FIELDS = [
  'name',
  'schedule',
  'scheduleHistory',
  'isBroadcasting',
  'isCapturing',
  'overtimeUntil',
  'broadcastStartedAt',
  'captureStartedAt',
  'frameRate',
  'sessionFrameRate',
  'activeSessionId',
  'imageQuality',
  'maxImageSize',
  'captureMode',
  'requireFullScreenOnly',
  'faceDebounceSeconds',
  'aiMonitoringMode',
  'enableClientAi',
  'preloadClientAi',
  'gazeSensitivity',
  'customYawAngle',
  'customPitchDownAngle',
  'customPitchUpAngle',
  'enableCloudFallback',
  'cloudFallbackRate',
  'enableAudioCapture',
  'audioCaptureMode',
  'voiceAiMode',
  'speechLanguage',
  'audioSegmentDuration',
  'audioSilenceSuppression',
  'vadSensitivity',
  'voiceAiCloudFallbackRate',
  'enableSegmentTranscription',
  'audioMovingWindowDuration',
  'audioMovingWindowStride',
  'retentionDays',
  'gemmaIntentPrompt',
  'liveAudioPrompt',
  'sessionAudioPrompt',
  'isExamActive',
  'examPeriods',
  'studentRecordingsPolicy',
  'studentRecordingsReleaseDate',
  'teacherRecordingsPolicy',
  'allowShareTeacherRecordings',
];

export function extractPublicStudentConfig(classData = {}) {
  const config = {};
  if (!classData || typeof classData !== 'object') return config;
  for (const field of PUBLIC_STUDENT_CONFIG_FIELDS) {
    if (classData[field] !== undefined) {
      config[field] = classData[field];
    }
  }
  return config;
}

function normalizeComparable(val) {
  if (val === null || val === undefined) return val;
  if (typeof val?.toMillis === 'function') return { __tsMillis: val.toMillis() };
  if (val instanceof Date) return { __dateMillis: val.getTime() };
  if (typeof val === 'object' && typeof val._seconds === 'number' && typeof val._nanoseconds === 'number') {
    return { __tsMillis: val._seconds * 1000 + Math.floor(val._nanoseconds / 1e6) };
  }
  if (typeof val === 'object' && typeof val.seconds === 'number' && typeof val.nanoseconds === 'number') {
    return { __tsMillis: val.seconds * 1000 + Math.floor(val.nanoseconds / 1e6) };
  }
  if (Array.isArray(val)) return val.map(normalizeComparable);
  if (typeof val === 'object') {
    const sorted = {};
    for (const k of Object.keys(val).sort()) {
      sorted[k] = normalizeComparable(val[k]);
    }
    return sorted;
  }
  return val;
}

async function main() {
  console.log(`\n🔐 Running Firestore PII Isolation Backfill`);
  console.log(`   Project : ${projectId}`);
  console.log(`   Mode    : ${dryRun ? 'DRY RUN (no writes)' : 'LIVE APPLY'}\n`);

  const app = initializeApp({ projectId }, `pii-backfill-${Date.now()}`);
  const db = getFirestore(app);
  const auth = getAuth(app);

  // 1. Backfill classes/{classId}/studentConfig/public
  const classesSnap = await db.collection('classes').get();
  let classesScanned = 0;
  let classesWritten = 0;
  let classesSkipped = 0;

  for (const classDoc of classesSnap.docs) {
    classesScanned++;
    const classId = classDoc.id;
    const classData = classDoc.data() || {};
    const expectedPayload = extractPublicStudentConfig(classData);
    const pubRef = db.doc(`classes/${classId}/studentConfig/public`);
    const existingPubSnap = await pubRef.get();

    const matchesExisting =
      existingPubSnap.exists &&
      JSON.stringify(normalizeComparable(existingPubSnap.data() || {})) ===
        JSON.stringify(normalizeComparable(expectedPayload));

    if (matchesExisting) {
      classesSkipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would sync classes/${classId}/studentConfig/public (${Object.keys(expectedPayload).length} fields)`);
    } else {
      await pubRef.set(expectedPayload);
      console.log(`  ✅ Synced classes/${classId}/studentConfig/public (${Object.keys(expectedPayload).length} fields)`);
    }
    classesWritten++;
  }

  console.log(`\n📊 Classes summary: scanned=${classesScanned}, synced=${classesWritten}, already_in_sync=${classesSkipped}\n`);

  // 2. Backfill studentProfiles/{uid}.passkeyPermanentExempt from system_config/loginPolicy
  const loginPolicySnap = await db.doc('system_config/loginPolicy').get();
  const policyData = loginPolicySnap.exists ? loginPolicySnap.data() || {} : {};
  const whitelistEmails = new Set(
    (Array.isArray(policyData.passwordWhitelist) ? policyData.passwordWhitelist : [])
      .map((e) => (typeof e === 'string' ? e.toLowerCase().trim() : ''))
      .filter(Boolean)
  );
  const whitelistUids = new Set(
    (Array.isArray(policyData.passwordWhitelistUids) ? policyData.passwordWhitelistUids : [])
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean)
  );

  // Resolve any email-only whitelist entries via Firebase Auth
  let resolvedEmailUids = 0;
  for (const email of whitelistEmails) {
    try {
      const userRecord = await auth.getUserByEmail(email);
      if (userRecord?.uid && !whitelistUids.has(userRecord.uid)) {
        whitelistUids.add(userRecord.uid);
        resolvedEmailUids++;
      }
    } catch {
      console.warn(`  ⚠️ Could not resolve UID for whitelisted email: ${email}`);
    }
  }

  let exemptionsSet = 0;
  let exemptionsCleared = 0;

  for (const uid of whitelistUids) {
    const profileRef = db.doc(`studentProfiles/${uid}`);
    const profileSnap = await profileRef.get();
    const profileData = profileSnap.exists ? profileSnap.data() || {} : {};
    if (profileData.passkeyPermanentExempt === true) continue;

    if (dryRun) {
      console.log(`  [DRY RUN] Would set passkeyPermanentExempt=true on studentProfiles/${uid}`);
    } else {
      await profileRef.set(
        {
          passkeyPermanentExempt: true,
          passkeyExemptionReason: 'Backfilled from system_config/loginPolicy',
          passkeyExemptionUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.log(`  ✅ Set passkeyPermanentExempt=true on studentProfiles/${uid}`);
    }
    exemptionsSet++;
  }

  // Clear stale passkeyPermanentExempt=true flags for students removed from loginPolicy
  const staleSnap = await db.collection('studentProfiles').where('passkeyPermanentExempt', '==', true).get();
  for (const docSnap of staleSnap.docs) {
    const uid = docSnap.id;
    const email = (docSnap.data()?.email || '').toLowerCase().trim();
    if (whitelistUids.has(uid) || (email && whitelistEmails.has(email))) continue;

    if (dryRun) {
      console.log(`  [DRY RUN] Would clear stale passkeyPermanentExempt on studentProfiles/${uid}`);
    } else {
      await docSnap.ref.set(
        {
          passkeyPermanentExempt: false,
          passkeyExemptionUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.log(`  ✅ Cleared stale passkeyPermanentExempt on studentProfiles/${uid}`);
    }
    exemptionsCleared++;
  }

  console.log(
    `📊 Exemption summary: whitelistEmails=${whitelistEmails.size}, totalTargetUids=${whitelistUids.size} (resolvedFromEmail=${resolvedEmailUids}), set=${exemptionsSet}, cleared=${exemptionsCleared}\n`
  );
}

main()
  .then(() => {
    console.log('✅ Backfill complete.\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  });
