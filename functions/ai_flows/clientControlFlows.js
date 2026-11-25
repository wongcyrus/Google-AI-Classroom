import './firebase.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { CORS_ORIGINS, FUNCTION_REGION, deriveUserRole } from './config.js';

export const VALID_REFRESH_MODES = ['prompt', 'force_idle', 'force_now'];

export async function handleTriggerClientRefresh({ auth, data }) {
  if (!auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication is required to trigger a client refresh.');
  }

  const tokenRole = auth.token?.role;
  const email = auth.token?.email || '';
  const derivedRole = deriveUserRole(email);
  const isTeacherOrAdmin =
    tokenRole === 'teacher' ||
    tokenRole === 'admin' ||
    derivedRole === 'teacher';

  if (!isTeacherOrAdmin) {
    throw new HttpsError('permission-denied', 'Only teachers or administrators can broadcast a client refresh.');
  }

  const requestedMode = typeof data?.mode === 'string' ? data.mode.trim() : 'prompt';
  if (!VALID_REFRESH_MODES.includes(requestedMode)) {
    throw new HttpsError(
      'invalid-argument',
      `Invalid refresh mode "${requestedMode}". Must be one of: ${VALID_REFRESH_MODES.join(', ')}.`
    );
  }

  const rawMessage = typeof data?.message === 'string' ? data.message.trim() : '';
  const cleanMessage = rawMessage ? rawMessage.slice(0, 160) : null;

  const forceReloadBefore = Date.now();
  const updatedAt = new Date(forceReloadBefore).toISOString();
  const triggeredBy = email || auth.uid;

  const db = getFirestore();
  await db.doc('system_config/clientControl').set(
    {
      forceReloadBefore,
      mode: requestedMode,
      message: cleanMessage,
      triggeredBy,
      updatedAt,
    },
    { merge: true }
  );

  return {
    success: true,
    forceReloadBefore,
    mode: requestedMode,
    message: cleanMessage,
    triggeredBy,
    updatedAt,
  };
}

export const triggerClientRefresh = onCall(
  {
    region: FUNCTION_REGION,
    cors: CORS_ORIGINS,
    enforceAppCheck: false,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    return await handleTriggerClientRefresh({
      auth: request.auth,
      data: request.data || {},
    });
  }
);
