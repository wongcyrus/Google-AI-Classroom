import admin from 'firebase-admin';

try {
  admin.initializeApp();
} catch (e) {
  // console.error('Firebase admin initialization error', e);
}

export const db = admin.firestore();
export const auth = admin.auth();
