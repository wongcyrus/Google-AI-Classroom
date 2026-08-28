import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const app = getApps().length === 0 ? initializeApp() : getApps()[0];

export const db = getFirestore(app);
export const auth = getAuth(app);
