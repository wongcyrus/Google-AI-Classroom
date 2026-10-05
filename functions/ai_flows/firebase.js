import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-2627';
  initializeApp({
    projectId,
    storageBucket: process.env.STORAGE_BUCKET_NAME || `${projectId}.firebasestorage.app`,
  });
}

try {
  getFirestore().settings({ ignoreUndefinedProperties: true });
} catch {}
