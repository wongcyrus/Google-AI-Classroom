import './firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { HttpsError } from 'firebase-functions/v2/https';
import crypto from 'crypto';
import { deriveUserRole, isPasskeySharingWhitelisted } from './config.js';

const db = getFirestore();

export const RP_NAME = 'Gemini AI Classroom Assistant';

export const ALLOWED_RP_IDS = [
  'it114115-2627.web.app',
  'it114115-2627.firebaseapp.com',
  'it114115-dev-2026.web.app',
  'it114115-dev-2026.firebaseapp.com',
  'localhost',
  '127.0.0.1',
];

export const ALLOWED_ORIGINS = [
  'https://it114115-2627.web.app',
  'https://it114115-2627.firebaseapp.com',
  'https://it114115-dev-2026.web.app',
  'https://it114115-dev-2026.firebaseapp.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
];

/**
 * Resolves safe RP ID based on client request or runtime environment
 */
export function resolveRpId(clientRpId) {
  if (clientRpId && ALLOWED_RP_IDS.includes(clientRpId)) {
    return clientRpId;
  }
  const projectId = process.env.GCLOUD_PROJECT || (() => {
    try { return JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId; } catch { return ''; }
  })() || '';

  if (projectId.includes('dev')) {
    return 'it114115-dev-2026.web.app';
  }
  return 'it114115-2627.web.app';
}

/**
 * 1. Request Passkey Pairing Token (Student / Teacher on Lab PC)
 * Generates a temporary 10-minute token for mobile phone pairing without typing password
 */
export async function handleRequestPasskeyPairingToken({ studentUid, studentEmail, classId }) {
  if (!studentUid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to request pairing token.');
  }

  const role = deriveUserRole(studentEmail) || 'student';
  const tokenId = crypto.randomUUID();
  const expiresAtMillis = Date.now() + 10 * 60 * 1000; // 10 minutes

  await db.doc(`passkeyPairingTokens/${tokenId}`).set({
    tokenId,
    studentUid,
    studentEmail: (studentEmail || '').toLowerCase(),
    role,
    classId: classId || null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAtMillis,
    used: false,
  });

  return { tokenId, expiresAtMillis, role };
}

/**
 * 2. Get Passkey Registration Options (Mobile Phone via Scanned QR)
 */
export async function handleGetPasskeyRegistrationOptions({ pairingToken, clientRpId }) {
  if (!pairingToken) {
    throw new HttpsError('invalid-argument', 'Missing pairing token.');
  }

  const tokenRef = db.doc(`passkeyPairingTokens/${pairingToken}`);
  const tokenDoc = await tokenRef.get();

  if (!tokenDoc.exists) {
    throw new HttpsError('not-found', 'Invalid pairing token.');
  }

  const tokenData = tokenDoc.data();
  if (tokenData.used) {
    throw new HttpsError('failed-precondition', 'This pairing token has already been used.');
  }

  if (Date.now() > tokenData.expiresAtMillis) {
    throw new HttpsError('deadline-exceeded', 'This pairing token has expired. Please refresh the QR code on your PC.');
  }

  const rpID = resolveRpId(clientRpId);
  const userRole = tokenData.role || deriveUserRole(tokenData.studentEmail) || 'student';
  const roleLabel = userRole === 'teacher' ? 'Teacher' : 'Student';
  const userDisplayName = tokenData.studentEmail
    ? `${tokenData.studentEmail.split('@')[0]} (${roleLabel})`
    : roleLabel;

  // Generate WebAuthn options for registering biometric passkey
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new Uint8Array(Buffer.from(tokenData.studentUid)),
    userName: tokenData.studentEmail || tokenData.studentUid,
    userDisplayName,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });

  // Save the registration challenge onto the pairing token document
  await tokenRef.update({
    currentChallenge: options.challenge,
    rpIdUsed: rpID,
  });

  return options;
}

/**
 * 3. Verify Passkey Registration (Mobile Phone)
 * Enforces 1-PHONE = 1-STUDENT Hardware Lock!
 */
export async function handleVerifyPasskeyRegistration({ pairingToken, attestationResponse, clientRpId, deviceModel, deviceFingerprint }) {
  if (!pairingToken || !attestationResponse) {
    throw new HttpsError('invalid-argument', 'Missing pairing token or attestation response.');
  }

  const tokenRef = db.doc(`passkeyPairingTokens/${pairingToken}`);
  const tokenDoc = await tokenRef.get();

  if (!tokenDoc.exists) {
    throw new HttpsError('not-found', 'Invalid pairing token.');
  }

  const tokenData = tokenDoc.data();
  if (tokenData.used) {
    throw new HttpsError('failed-precondition', 'This pairing token has already been used.');
  }

  if (Date.now() > tokenData.expiresAtMillis) {
    throw new HttpsError('deadline-exceeded', 'Pairing token expired.');
  }

  const expectedChallenge = tokenData.currentChallenge;
  if (!expectedChallenge) {
    throw new HttpsError('failed-precondition', 'No registration challenge found for this token.');
  }

  const rpID = resolveRpId(clientRpId || tokenData.rpIdUsed);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge,
      expectedOrigin: ALLOWED_ORIGINS,
      expectedRPID: ALLOWED_RP_IDS,
      requireUserVerification: false,
    });
  } catch (err) {
    console.error('[verifyPasskeyRegistration] WebAuthn verification error:', err);
    throw new HttpsError('invalid-argument', `WebAuthn registration failed: ${err.message}`);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpsError('invalid-argument', 'Passkey registration could not be verified.');
  }

  const { credential } = verification.registrationInfo;
  const credentialID = credential.id;

  // =========================================================================
  // CRITICAL SECURITY ENFORCEMENT: 1 Phone = 1 Student Hardware Lock
  // 1. Check persistent deviceFingerprint: A phone cannot be shared across multiple students!
  //    EXCEPTION: Teachers and whitelisted testing accounts can share devices across roles.
  // 2. Check WebAuthn credentialID: Credential cannot be shared across multiple students!
  // =========================================================================
  const userRole = tokenData.role || deriveUserRole(tokenData.studentEmail) || 'student';
  const isIncomingWhitelisted = userRole === 'teacher' || isPasskeySharingWhitelisted(tokenData.studentEmail);

  if (deviceFingerprint) {
    const existingDeviceSnap = await db.collection('studentPasskeys')
      .where('deviceFingerprint', '==', deviceFingerprint)
      .get();

    if (!existingDeviceSnap.empty) {
      for (const doc of existingDeviceSnap.docs) {
        if (doc.id !== tokenData.studentUid) {
          const existingData = doc.data() || {};
          const boundEmail = existingData.studentEmail || doc.id;
          const existingRole = existingData.role || deriveUserRole(boundEmail) || 'student';
          const isExistingWhitelisted = existingRole === 'teacher' || isPasskeySharingWhitelisted(boundEmail);

          // Enforce 1 Phone = 1 Student lock if neither account is a teacher or whitelisted
          if (!isIncomingWhitelisted && !isExistingWhitelisted) {
            console.warn(`[verifyPasskeyRegistration] Hardware collision! Phone ${deviceFingerprint} already registered to student ${boundEmail}`);
            throw new HttpsError(
              'already-exists',
              `Hardware Lock: This physical phone is already bound to student account (${boundEmail}). Each mobile phone can only be used by one student.`
            );
          } else {
            console.info(`[verifyPasskeyRegistration] Multi-role device sharing permitted for phone ${deviceFingerprint} between ${boundEmail} and ${tokenData.studentEmail}`);
          }
        }
      }
    }
  }

  const existingSnap = await db.collection('studentPasskeys')
    .where('credentialID', '==', credentialID)
    .get();

  if (!existingSnap.empty) {
    for (const doc of existingSnap.docs) {
      if (doc.id !== tokenData.studentUid) {
        console.warn(`[verifyPasskeyRegistration] Hardware collision detected! Phone credential ${credentialID} already registered to student ${doc.id}`);
        throw new HttpsError(
          'already-exists',
          'This physical mobile device is already registered to another user. Each phone can only be paired with one user account.'
        );
      }
    }
  }

  const credentialPublicKey = Buffer.from(credential.publicKey).toString('base64');
  const transports = credential.transports || attestationResponse.response?.transports || ['internal'];

  // Save the passkey with persistent hardware device fingerprint and role
  await db.doc(`studentPasskeys/${tokenData.studentUid}`).set({
    studentUid: tokenData.studentUid,
    studentEmail: tokenData.studentEmail,
    role: userRole,
    credentialID,
    credentialPublicKey,
    deviceFingerprint: deviceFingerprint || null,
    counter: credential.counter || 0,
    deviceModel: deviceModel || 'Mobile Device',
    transports,
    registeredAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Mark token as used
  await tokenRef.update({
    used: true,
    completedAt: FieldValue.serverTimestamp(),
  });

  return {
    verified: true,
    studentUid: tokenData.studentUid,
    role: userRole,
    deviceModel: deviceModel || 'Mobile Device',
  };
}

/**
 * 4. Get Passkey Authentication Options (For In-Class Routine Bingo Verification)
 */
export async function handleGetPasskeyAuthOptions({ classId, bingoId, clientRpId }) {
  if (!classId || !bingoId) {
    throw new HttpsError('invalid-argument', 'Missing classId or bingoId.');
  }

  const bingoRef = db.doc(`classes/${classId}/bingoRecords/${bingoId}`);
  const bingoDoc = await bingoRef.get();

  if (!bingoDoc.exists) {
    throw new HttpsError('not-found', 'Bingo challenge not found.');
  }

  const bingoData = bingoDoc.data();
  if (bingoData.result === 'passed') {
    return {
      alreadyPassed: true,
      message: 'Attendance challenge already verified.',
    };
  }

  const studentUid = bingoData.studentUid;
  const passkeyDoc = await db.doc(`studentPasskeys/${studentUid}`).get();

  if (!passkeyDoc.exists) {
    return {
      error: 'no_passkey',
      studentEmail: bingoData.studentEmail,
      message: 'No paired phone found for this student account. Please pair phone from your lab PC screen or request in-person teacher verification.',
    };
  }

  const passkey = passkeyDoc.data();
  const rpID = resolveRpId(clientRpId);

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [
      {
        id: passkey.credentialID,
        transports: passkey.transports || ['internal'],
      },
    ],
    userVerification: 'preferred',
  });

  // Store passkey challenge on the bingo record
  await bingoRef.update({
    passkeyChallenge: options.challenge,
    passkeyRpIdUsed: rpID,
  });

  return {
    options,
    studentEmail: bingoData.studentEmail,
    timeLimitSeconds: bingoData.timeLimitSeconds,
    expiresAtMillis: bingoData.expiresAtMillis,
    deviceModel: passkey.deviceModel,
  };
}

/**
 * 5. Verify Passkey Authentication (Instant ~2s Attendance Verification)
 */
export async function handleVerifyPasskeyAuth({ classId, bingoId, assertionResponse, clientRpId, timeToCompleteMillis, deviceFingerprint }) {
  if (!classId || !bingoId || !assertionResponse) {
    throw new HttpsError('invalid-argument', 'Missing classId, bingoId, or assertion response.');
  }

  const bingoRef = db.doc(`classes/${classId}/bingoRecords/${bingoId}`);
  const bingoDoc = await bingoRef.get();

  if (!bingoDoc.exists) {
    throw new HttpsError('not-found', 'Bingo record not found.');
  }

  const bingoData = bingoDoc.data();
  if (bingoData.result === 'passed') {
    return { verified: true, alreadyPassed: true };
  }

  const studentUid = bingoData.studentUid;
  const passkeyRef = db.doc(`studentPasskeys/${studentUid}`);
  const passkeyDoc = await passkeyRef.get();

  if (!passkeyDoc.exists) {
    throw new HttpsError('failed-precondition', 'No passkey registered for this student.');
  }

  const passkey = passkeyDoc.data();

  // Verify device fingerprint if bound
  if (passkey.deviceFingerprint && deviceFingerprint && passkey.deviceFingerprint !== deviceFingerprint) {
    console.warn(`[verifyPasskeyAuth] Device mismatch! Registered: ${passkey.deviceFingerprint}, got: ${deviceFingerprint}`);
    throw new HttpsError('permission-denied', 'Device Mismatch: Attendance must be verified using your registered mobile phone.');
  }

  // Verify the assertion credential ID matches the student's registered credential
  if (assertionResponse.id !== passkey.credentialID) {
    throw new HttpsError(
      'permission-denied',
      'Credential mismatch: This phone does not match the paired hardware key for this student.'
    );
  }

  const expectedChallenge = bingoData.passkeyChallenge;
  if (!expectedChallenge) {
    throw new HttpsError('failed-precondition', 'Missing authentication challenge on bingo record.');
  }

  const rpID = resolveRpId(clientRpId || bingoData.passkeyRpIdUsed);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: ALLOWED_ORIGINS,
      expectedRPID: ALLOWED_RP_IDS,
      credential: {
        id: passkey.credentialID,
        publicKey: new Uint8Array(Buffer.from(passkey.credentialPublicKey, 'base64')),
        counter: passkey.counter || 0,
        transports: passkey.transports,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    console.error('[verifyPasskeyAuth] WebAuthn authentication error:', err);
    throw new HttpsError('invalid-argument', `Biometric verification failed: ${err.message}`);
  }

  if (!verification.verified) {
    throw new HttpsError('invalid-argument', 'Passkey biometric verification failed.');
  }

  // Update passkey counter
  await passkeyRef.update({
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: FieldValue.serverTimestamp(),
  });

  const elapsedSec = timeToCompleteMillis
    ? Math.max(0.1, Math.round(Number(timeToCompleteMillis) / 100) / 10)
    : Math.max(0.1, Math.round((Date.now() - bingoData.issuedAtMillis) / 100) / 10);

  // Update Bingo Record
  await bingoRef.update({
    result: 'passed',
    status: 'completed',
    passkeyVerified: true,
    inPersonVerified: false,
    responseTimeSec: elapsedSec,
    answeredAt: FieldValue.serverTimestamp(),
    pointsAwarded: 10,
  });

  // Update Student Active Bingo Realtime State
  try {
    await db.doc(`classes/${classId}/studentProperties/${studentUid}`).update({
      'activeBingo.result': 'passed',
      'activeBingo.status': 'completed',
      'activeBingo.passkeyVerified': true,
      'activeBingo.responseTimeSec': elapsedSec,
      'activeBingo.pointsAwarded': 10,
    });
  } catch (propErr) {
    console.warn('[verifyPasskeyAuth] Failed to update student activeBingo property:', propErr);
  }

  return {
    verified: true,
    responseTimeSec: elapsedSec,
  };
}

/**
 * 6. Student In-Person Claim (Lab PC fallback when student phone is dead or broken)
 */
export async function handleClaimInPersonAttendance({ classId, bingoId, studentUid }) {
  if (!classId || !bingoId || !studentUid) {
    throw new HttpsError('invalid-argument', 'Missing classId, bingoId, or studentUid.');
  }

  const bingoRef = db.doc(`classes/${classId}/bingoRecords/${bingoId}`);
  const bingoDoc = await bingoRef.get();

  if (!bingoDoc.exists) {
    throw new HttpsError('not-found', 'Bingo record not found.');
  }

  const bingoData = bingoDoc.data();
  if (bingoData.studentUid !== studentUid) {
    throw new HttpsError('permission-denied', 'Cannot claim in-person verification for another student.');
  }

  if (bingoData.result === 'passed') {
    return { success: true, message: 'Already passed.' };
  }

  await bingoRef.update({
    inPersonClaim: true,
    inPersonClaimedAt: FieldValue.serverTimestamp(),
  });

  try {
    await db.doc(`classes/${classId}/studentProperties/${studentUid}`).update({
      'activeBingo.inPersonClaim': true,
    });
  } catch (e) {
    console.warn('[handleClaimInPersonAttendance] Failed to update student property:', e);
  }

  return { success: true };
}

/**
 * 7. Teacher In-Person Podium Override
 * Teacher physically checks the student standing at the podium and approves presence
 */
export async function handleVerifyInPersonAttendanceOverride({ classId, bingoId, studentUid, teacherUid, teacherEmail }) {
  if (!classId || !bingoId || !studentUid) {
    throw new HttpsError('invalid-argument', 'Missing classId, bingoId, or studentUid.');
  }

  const bingoRef = db.doc(`classes/${classId}/bingoRecords/${bingoId}`);
  const bingoDoc = await bingoRef.get();

  if (!bingoDoc.exists) {
    throw new HttpsError('not-found', 'Bingo record not found.');
  }

  await bingoRef.update({
    result: 'passed',
    status: 'completed',
    inPersonVerified: true,
    passkeyVerified: false,
    inPersonClaim: false,
    verifiedByTeacherUid: teacherUid || null,
    verifiedByTeacherEmail: teacherEmail || 'teacher',
    verifiedAt: FieldValue.serverTimestamp(),
    pointsAwarded: 10,
  });

  try {
    await db.doc(`classes/${classId}/studentProperties/${studentUid}`).update({
      'activeBingo.result': 'passed',
      'activeBingo.status': 'completed',
      'activeBingo.inPersonVerified': true,
      'activeBingo.inPersonClaim': false,
      'activeBingo.pointsAwarded': 10,
    });
  } catch (e) {
    console.warn('[handleVerifyInPersonAttendanceOverride] Failed to update student property:', e);
  }

  return { success: true };
}

/**
 * 8. Get Student Passkey Status
 */
export async function handleGetStudentPasskeyStatus({ studentUid }) {
  if (!studentUid) {
    throw new HttpsError('invalid-argument', 'Missing studentUid.');
  }

  const doc = await db.doc(`studentPasskeys/${studentUid}`).get();
  if (!doc.exists) {
    return { isPaired: false };
  }

  const data = doc.data();
  return {
    isPaired: true,
    deviceModel: data.deviceModel || 'Mobile Device',
    registeredAt: data.registeredAt || null,
  };
}

/**
 * 9. Reset Student Passkey (Teacher-Assisted Phone Replacement)
 * Unbinds student's old phone so they can scan pairing QR code with their new phone
 */
export async function handleResetStudentPasskey({ studentUid, studentEmail, classId, teacherUid, teacherEmail, reason }) {
  let targetUid = studentUid;
  let targetEmail = studentEmail ? studentEmail.toLowerCase() : '';

  if (!targetUid && targetEmail) {
    const snap = await db.collection('studentPasskeys')
      .where('studentEmail', '==', targetEmail)
      .limit(1)
      .get();
    if (!snap.empty) {
      targetUid = snap.docs[0].id;
    }
  }

  if (!targetUid && !targetEmail) {
    throw new HttpsError('invalid-argument', 'Missing studentUid or studentEmail.');
  }

  let previousData = null;
  if (targetUid) {
    const passkeyRef = db.doc(`studentPasskeys/${targetUid}`);
    const passkeyDoc = await passkeyRef.get();
    if (passkeyDoc.exists) {
      previousData = passkeyDoc.data();
      if (!targetEmail && previousData.studentEmail) {
        targetEmail = previousData.studentEmail;
      }
      await passkeyRef.delete();
    }
  }

  // Record audit log
  await db.collection('passkeyAuditLogs').add({
    studentUid: targetUid || 'unknown',
    studentEmail: targetEmail || null,
    action: 'RESET_PASSKEY_PHONE_REPLACEMENT',
    reason: reason || 'Phone replacement',
    teacherUid: teacherUid || null,
    teacherEmail: teacherEmail || 'teacher',
    previousCredentialID: previousData?.credentialID || null,
    previousDeviceModel: previousData?.deviceModel || null,
    timestamp: FieldValue.serverTimestamp(),
  });

  // Clear or update student properties if classId provided
  if (classId && targetUid) {
    try {
      await db.doc(`classes/${classId}/studentProperties/${targetUid}`).update({
        'passkeyStatus': 'unpaired',
        'passkeyResetAt': FieldValue.serverTimestamp(),
        'passkeyResetBy': teacherEmail || 'teacher',
      });
    } catch (e) {
      console.warn('[handleResetStudentPasskey] Could not update student properties:', e);
    }
  }

  return {
    success: true,
    studentUid: targetUid,
    studentEmail: targetEmail,
    previousDeviceModel: previousData?.deviceModel || null,
    message: 'Passkey reset successfully. Student can now pair their new mobile phone.',
  };
}

export const DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC = 15;
export const DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_MS = DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC * 1000;
export const DESKTOP_QR_GRACE_INTERVALS = 1; // Allows current + 1 previous interval (~15-30s window)

/**
 * Computes a dynamic rotating token for a desktop login session given sessionSecret and timeInterval.
 */
export function computeDesktopQrToken(sessionSecret, timeInterval) {
  if (!sessionSecret) return '';
  return crypto
    .createHmac('sha256', sessionSecret)
    .update(`desktop_login_qr_${timeInterval}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Validates a dynamic rotating token against a desktop session secret and timestamp with grace intervals.
 */
export function isValidDesktopQrToken(sessionSecret, token, timestamp = Date.now(), rotationIntervalMs = DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_MS) {
  if (!sessionSecret || !token || typeof token !== 'string' || token.length !== 16) {
    return false;
  }
  const intervalMs = Number(rotationIntervalMs) > 0 ? Number(rotationIntervalMs) : DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_MS;
  const currentInterval = Math.floor(timestamp / intervalMs);
  for (let i = 0; i <= DESKTOP_QR_GRACE_INTERVALS; i++) {
    const expected = computeDesktopQrToken(sessionSecret, currentInterval - i);
    if (expected.length === token.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

/**
 * 10. Initiate Desktop Login Session
 * Shared Lab PC calls this to generate an ephemeral login session and rotating QR payload.
 */
export async function handleInitiateDesktopLoginSession({ clientRpId } = {}) {
  const sessionId = crypto.randomUUID();
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const expiresAtMillis = Date.now() + 5 * 60 * 1000; // 5 minutes
  const rpId = resolveRpId(clientRpId);

  await db.doc(`loginSessions/${sessionId}`).set({
    sessionId,
    sessionSecret,
    rotationIntervalSeconds: DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAtMillis,
    rpId,
    customToken: null,
    studentUid: null,
    studentEmail: null,
  });

  return {
    sessionId,
    sessionSecret,
    rotationIntervalSeconds: DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC,
    expiresAtMillis,
    qrUrl: `/mobile-login?session=${sessionId}`,
  };
}

/**
 * 11. Get Desktop Login Passkey Options
 * Scanned from mobile camera: retrieves WebAuthn challenge for the desktop login session.
 */
export async function handleGetDesktopLoginPasskeyOptions({ sessionId, token, clientRpId }) {
  if (!sessionId) {
    throw new HttpsError('invalid-argument', 'Missing sessionId.');
  }

  const sessionRef = db.doc(`loginSessions/${sessionId}`);
  const sessionDoc = await sessionRef.get();

  if (!sessionDoc.exists) {
    throw new HttpsError('not-found', 'Login session not found or expired.');
  }

  const sessionData = sessionDoc.data();
  if (sessionData.status !== 'pending') {
    throw new HttpsError('failed-precondition', `Session is ${sessionData.status}.`);
  }

  if (Date.now() > sessionData.expiresAtMillis) {
    await sessionRef.update({ status: 'expired' });
    throw new HttpsError('deadline-exceeded', 'Login session expired. Please refresh the QR code on the desktop.');
  }

  // Validate dynamic rotating token if session has a secret
  if (sessionData.sessionSecret) {
    const rotationIntervalMs = (sessionData.rotationIntervalSeconds || DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC) * 1000;
    if (!isValidDesktopQrToken(sessionData.sessionSecret, token, Date.now(), rotationIntervalMs)) {
      throw new HttpsError(
        'invalid-argument',
        'Expired or invalid QR code. Please scan the current live QR code displayed on the lab desktop screen.'
      );
    }
  }

  const rpID = resolveRpId(clientRpId || sessionData.rpId);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });

  await sessionRef.update({
    challenge: options.challenge,
    tokenUsed: token || null,
    rpIdUsed: rpID,
  });

  return {
    options,
    sessionId,
    expiresAtMillis: sessionData.expiresAtMillis,
  };
}

/**
 * 12. Verify Desktop Login Passkey
 * Mobile device submits biometric assertion. If verified, mints Firebase Custom Auth Token
 * for the desktop session so the shared PC signs in automatically.
 */
export async function handleVerifyDesktopLoginPasskey({ sessionId, token, authenticationResponse, clientRpId, deviceFingerprint }) {
  if (!sessionId || !authenticationResponse) {
    throw new HttpsError('invalid-argument', 'Missing sessionId or authenticationResponse.');
  }

  const sessionRef = db.doc(`loginSessions/${sessionId}`);
  const sessionDoc = await sessionRef.get();

  if (!sessionDoc.exists) {
    throw new HttpsError('not-found', 'Login session not found.');
  }

  const sessionData = sessionDoc.data();
  if (sessionData.status !== 'pending') {
    throw new HttpsError('failed-precondition', `Login session is already ${sessionData.status}.`);
  }

  if (Date.now() > sessionData.expiresAtMillis) {
    await sessionRef.update({ status: 'expired' });
    throw new HttpsError('deadline-exceeded', 'Login session expired.');
  }

  // Validate dynamic rotating token if session has a secret
  if (sessionData.sessionSecret) {
    const tokenToVerify = token || sessionData.tokenUsed;
    const rotationIntervalMs = (sessionData.rotationIntervalSeconds || DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC) * 1000;
    if (!isValidDesktopQrToken(sessionData.sessionSecret, tokenToVerify, Date.now(), rotationIntervalMs)) {
      throw new HttpsError(
        'invalid-argument',
        'The scanned login QR token has expired. Please scan the live QR code on the desktop.'
      );
    }
  }

  const expectedChallenge = sessionData.challenge;
  if (!expectedChallenge) {
    throw new HttpsError('failed-precondition', 'Missing challenge in login session.');
  }

  const credentialId = authenticationResponse.id;
  if (!credentialId) {
    throw new HttpsError('invalid-argument', 'Missing credential ID in authentication response.');
  }

  // Lookup passkey by hardware credential ID
  const passkeySnap = await db.collection('studentPasskeys')
    .where('credentialID', '==', credentialId)
    .limit(1)
    .get();

  if (passkeySnap.empty) {
    throw new HttpsError('not-found', 'No passkey found matching this mobile device. Please pair your phone first.');
  }

  const passkeyDoc = passkeySnap.docs[0];
  const passkeyData = passkeyDoc.data();
  const studentUid = passkeyDoc.id;

  // Resolve role: prioritize stored passkeyData.role, then derive from email, then custom claims
  let detectedRole = passkeyData.role;
  if (!detectedRole && passkeyData.studentEmail) {
    detectedRole = deriveUserRole(passkeyData.studentEmail);
  }
  if (!detectedRole) {
    try {
      const userRecord = await getAuth().getUser(studentUid);
      if (userRecord.customClaims?.role) {
        detectedRole = userRecord.customClaims.role;
      }
    } catch (e) {
      console.warn(`[verifyDesktopLoginPasskey] Could not fetch userRecord for ${studentUid}:`, e.message);
    }
  }
  detectedRole = detectedRole || 'student';

  // Verify device fingerprint if bound
  if (passkeyData.deviceFingerprint && deviceFingerprint && passkeyData.deviceFingerprint !== deviceFingerprint) {
    console.warn(`[verifyDesktopLoginPasskey] Device mismatch! Registered: ${passkeyData.deviceFingerprint}, got: ${deviceFingerprint}`);
    throw new HttpsError('permission-denied', 'Device Mismatch: This passkey was registered on a different physical smartphone.');
  }

  const rpID = resolveRpId(clientRpId || sessionData.rpIdUsed);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: authenticationResponse,
      expectedChallenge,
      expectedOrigin: ALLOWED_ORIGINS,
      expectedRPID: ALLOWED_RP_IDS,
      credential: {
        id: passkeyData.credentialID,
        publicKey: new Uint8Array(Buffer.from(passkeyData.credentialPublicKey, 'base64')),
        counter: passkeyData.counter || 0,
        transports: passkeyData.transports,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    console.error('[verifyDesktopLoginPasskey] WebAuthn verification error:', err);
    throw new HttpsError('invalid-argument', `Biometric authentication failed: ${err.message}`);
  }

  if (!verification.verified) {
    throw new HttpsError('invalid-argument', 'Passkey biometric verification failed.');
  }

  // Update passkey counter & last login
  await passkeyDoc.ref.update({
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: FieldValue.serverTimestamp(),
    lastLoginType: 'desktop_qr',
  });

  // Mint Firebase Custom Token for desktop with dynamic detected role
  const customToken = await getAuth().createCustomToken(studentUid, { role: detectedRole });

  // Update login session to authorized
  await sessionRef.update({
    status: 'authorized',
    customToken,
    studentUid,
    studentEmail: passkeyData.studentEmail || null,
    role: detectedRole,
    deviceModel: passkeyData.deviceModel || 'Mobile Device',
    authorizedAt: FieldValue.serverTimestamp(),
  });

  // Audit log
  const auditAction = detectedRole === 'teacher' ? 'TEACHER_DESKTOP_LOGIN_VIA_MOBILE_QR' : 'DESKTOP_LOGIN_VIA_MOBILE_QR';
  await db.collection('passkeyAuditLogs').add({
    action: auditAction,
    role: detectedRole,
    studentUid,
    studentEmail: passkeyData.studentEmail || null,
    deviceModel: passkeyData.deviceModel || 'Mobile Device',
    sessionId,
    timestamp: FieldValue.serverTimestamp(),
  });

  return {
    verified: true,
    studentUid,
    studentEmail: passkeyData.studentEmail || null,
    role: detectedRole,
    deviceModel: passkeyData.deviceModel || 'Mobile Device',
    message: detectedRole === 'teacher'
      ? 'Teacher passkey verified. Desktop login authorized.'
      : 'Mobile passkey verified. Desktop login authorized.',
  };
}

/**
 * 13. Request Teacher Passkey Bypass (Student on Lab PC)
 * Creates a pending bypass claim for students with dead batteries, forgotten phones, or damaged cameras.
 */
export async function handleRequestTeacherPasskeyBypass({ studentUid, studentEmail, classId, deskNumber, reason }) {
  if (!classId) {
    throw new HttpsError('invalid-argument', 'Missing classId.');
  }
  if (!studentUid && !studentEmail) {
    throw new HttpsError('invalid-argument', 'Missing studentUid or studentEmail.');
  }

  const requestId = crypto.randomUUID();
  const normalizedEmail = (studentEmail || '').toLowerCase();

  await db.doc(`classes/${classId}/passkeyBypassRequests/${requestId}`).set({
    requestId,
    studentUid: studentUid || null,
    studentEmail: normalizedEmail,
    classId,
    deskNumber: deskNumber || 'Lab PC',
    reason: reason || 'Phone unavailable',
    status: 'pending',
    requestedAt: FieldValue.serverTimestamp(),
    expiresAtMillis: Date.now() + 15 * 60 * 1000, // 15 min TTL
  });

  // Also log the request
  await db.collection('passkeyAuditLogs').add({
    action: 'BYPASS_REQUEST_CREATED',
    studentUid: studentUid || null,
    studentEmail: normalizedEmail,
    classId,
    deskNumber: deskNumber || 'Lab PC',
    reason: reason || 'Phone unavailable',
    requestId,
    timestamp: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    requestId,
    message: 'Bypass request submitted. Please notify your instructor.',
  };
}

/**
 * 14. Approve Teacher Passkey Bypass (Teacher Podium 1-Click Action)
 * Grants a temporary lesson-scoped bypass for a student.
 */
export async function handleApproveTeacherPasskeyBypass({
  requestId,
  classId,
  studentUid,
  studentEmail,
  teacherUid,
  teacherEmail,
  bypassDurationMinutes = 180,
  approved = true,
}) {
  if (!classId) {
    throw new HttpsError('invalid-argument', 'Missing classId.');
  }

  let targetUid = studentUid;
  let targetEmail = (studentEmail || '').toLowerCase();
  let requestData = null;

  if (requestId) {
    const reqRef = db.doc(`classes/${classId}/passkeyBypassRequests/${requestId}`);
    const reqDoc = await reqRef.get();
    if (reqDoc.exists) {
      requestData = reqDoc.data();
      if (!targetUid && requestData.studentUid) targetUid = requestData.studentUid;
      if (!targetEmail && requestData.studentEmail) targetEmail = requestData.studentEmail;

      await reqRef.update({
        status: approved ? 'approved' : 'rejected',
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedBy: teacherEmail || 'teacher',
      });
    }
  }

  if (!targetUid && targetEmail) {
    const snap = await db.collection('studentPasskeys')
      .where('studentEmail', '==', targetEmail)
      .limit(1)
      .get();
    if (!snap.empty) {
      targetUid = snap.docs[0].id;
    }
  }

  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Could not resolve studentUid for bypass.');
  }

  const durationMin = Number(bypassDurationMinutes) || 180;
  const expiresAtMillis = Date.now() + durationMin * 60 * 1000;

  if (approved) {
    // Set bypass in studentProperties
    await db.doc(`classes/${classId}/studentProperties/${targetUid}`).set({
      passkeyBypass: {
        active: true,
        grantedAt: FieldValue.serverTimestamp(),
        expiresAtMillis,
        expiresAt: new Date(expiresAtMillis).toISOString(),
        grantedBy: teacherEmail || 'teacher',
        teacherUid: teacherUid || null,
        reason: requestData?.reason || 'Teacher Podium Approval',
        deskNumber: requestData?.deskNumber || null,
        scope: 'current_lesson',
      },
    }, { merge: true });

    // Record audit log
    await db.collection('passkeyAuditLogs').add({
      action: 'TEACHER_BYPASS_GRANTED',
      studentUid: targetUid,
      studentEmail: targetEmail || null,
      classId,
      teacherUid: teacherUid || null,
      teacherEmail: teacherEmail || 'teacher',
      reason: requestData?.reason || 'Teacher Podium Approval',
      deskNumber: requestData?.deskNumber || null,
      expiresAtMillis,
      timestamp: FieldValue.serverTimestamp(),
    });
  } else {
    // If rejected
    await db.collection('passkeyAuditLogs').add({
      action: 'TEACHER_BYPASS_REJECTED',
      studentUid: targetUid,
      studentEmail: targetEmail || null,
      classId,
      teacherUid: teacherUid || null,
      teacherEmail: teacherEmail || 'teacher',
      reason: requestData?.reason || 'Teacher Rejected',
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  return {
    success: true,
    approved,
    studentUid: targetUid,
    expiresAtMillis: approved ? expiresAtMillis : null,
    message: approved
      ? `Bypass granted for ${durationMin} minutes.`
      : 'Bypass request rejected.',
  };
}

/**
 * 15. Verify Teacher Emergency PIN (Aisle Walk-Around Direct PC Entry)
 * Allows teacher to punch in daily/lesson 6-digit PIN on student screen.
 */
export async function handleVerifyTeacherPasskeyBypassPin({ classId, studentUid, pin, reason, deskNumber }) {
  if (!classId || !studentUid || !pin) {
    throw new HttpsError('invalid-argument', 'Missing classId, studentUid, or pin.');
  }

  const classRef = db.doc(`classes/${classId}`);
  const classDoc = await classRef.get();

  if (!classDoc.exists) {
    throw new HttpsError('not-found', 'Class not found.');
  }

  const classData = classDoc.data();
  const validPin = classData.teacherBypassPin || classData.emergencyPasskeyPin;

  if (!validPin || String(pin).trim() !== String(validPin).trim()) {
    throw new HttpsError('permission-denied', 'Invalid teacher emergency PIN.');
  }

  const expiresAtMillis = Date.now() + 180 * 60 * 1000; // 180 minutes

  await db.doc(`classes/${classId}/studentProperties/${studentUid}`).set({
    passkeyBypass: {
      active: true,
      grantedAt: FieldValue.serverTimestamp(),
      expiresAtMillis,
      expiresAt: new Date(expiresAtMillis).toISOString(),
      grantedBy: 'Teacher Emergency PIN',
      reason: reason || 'In-Person Teacher Emergency PIN',
      deskNumber: deskNumber || null,
      scope: 'current_lesson',
    },
  }, { merge: true });

  await db.collection('passkeyAuditLogs').add({
    action: 'TEACHER_BYPASS_PIN_VERIFIED',
    studentUid,
    classId,
    deskNumber: deskNumber || null,
    reason: reason || 'In-Person Teacher Emergency PIN',
    expiresAtMillis,
    timestamp: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    studentUid,
    expiresAtMillis,
    message: 'Teacher emergency PIN verified. Bypass granted for current lesson.',
  };
}

// =========================================================================
// 16. LECTURE HALL DYNAMIC ROTATING QR CODE PASSKEY BINGO FLOWS
// =========================================================================

export const DEFAULT_LECTURE_QR_ROTATION_INTERVAL_SEC = 15;
export const DEFAULT_LECTURE_QR_ROTATION_INTERVAL_MS = DEFAULT_LECTURE_QR_ROTATION_INTERVAL_SEC * 1000; // 15-second default rotation
export const LECTURE_QR_ROTATION_INTERVAL_MS = DEFAULT_LECTURE_QR_ROTATION_INTERVAL_MS; // Backwards compatible alias
export const LECTURE_QR_GRACE_INTERVALS = 2; // Allow current + past 2 intervals (~30-45s window)

/**
 * Computes a dynamic rotating token for a lecture session given a session secret and interval.
 */
export function computeLectureQrToken(sessionSecret, timeInterval) {
  if (!sessionSecret) return '';
  return crypto
    .createHmac('sha256', sessionSecret)
    .update(`lecture_qr_bingo_${timeInterval}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Validates a dynamic rotating token against a session secret and timestamp with grace intervals.
 */
export function isValidLectureQrToken(sessionSecret, token, timestamp = Date.now(), rotationIntervalMs = DEFAULT_LECTURE_QR_ROTATION_INTERVAL_MS) {
  if (!sessionSecret || !token || typeof token !== 'string' || token.length !== 16) {
    return false;
  }
  const intervalMs = Number(rotationIntervalMs) > 0 ? Number(rotationIntervalMs) : DEFAULT_LECTURE_QR_ROTATION_INTERVAL_MS;
  const currentInterval = Math.floor(timestamp / intervalMs);
  for (let i = 0; i <= LECTURE_QR_GRACE_INTERVALS; i++) {
    const expected = computeLectureQrToken(sessionSecret, currentInterval - i);
    if (expected.length === token.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

/**
 * 16.1 Create Lecture Bingo Session (Teacher screen/projector modal)
 */
export async function handleCreateLectureBingoSession({ classId, timeLimitSeconds, rotationIntervalSeconds, teacherUid }) {
  if (!classId) {
    throw new HttpsError('invalid-argument', 'Missing classId.');
  }

  const classRef = db.doc(`classes/${classId}`);
  const classDoc = await classRef.get();
  if (!classDoc.exists) {
    throw new HttpsError('not-found', 'Class not found.');
  }

  const effectiveTimeLimit = Number(timeLimitSeconds) || 90;
  const effectiveRotationSec = Number(rotationIntervalSeconds) >= 5 ? Number(rotationIntervalSeconds) : DEFAULT_LECTURE_QR_ROTATION_INTERVAL_SEC;
  const effectiveRotationMs = effectiveRotationSec * 1000;

  const issuedAtMillis = Date.now();
  const expiresAtMillis = issuedAtMillis + effectiveTimeLimit * 1000;
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const roundId = `round_lecture_${issuedAtMillis}`;

  const bingoRef = db.collection(`classes/${classId}/bingoRecords`).doc();
  const bingoRecord = {
    id: bingoRef.id,
    roundId,
    classId,
    teacherUid: teacherUid || null,
    questionSource: 'lecture_passkey_qr',
    triggerType: 'teacher_lecture_qr',
    question: 'Lecture Hall Biometric Passkey Check-In',
    options: ['Biometric QR Check-In Verified'],
    correctIndex: 0,
    timeLimitSeconds: effectiveTimeLimit,
    rotationIntervalSeconds: effectiveRotationSec,
    rotationIntervalMs: effectiveRotationMs,
    issuedAt: FieldValue.serverTimestamp(),
    issuedAtMillis,
    expiresAtMillis,
    sessionSecret,
    status: 'active',
    result: 'pending',
    responses: {},
    verifiedStudentsCount: 0,
  };

  await bingoRef.set(bingoRecord);

  // Update active lecture session doc for quick real-time listeners
  await db.doc(`classes/${classId}/lectureQrSession/active`).set({
    bingoId: bingoRef.id,
    roundId,
    classId,
    status: 'active',
    issuedAtMillis,
    expiresAtMillis,
    timeLimitSeconds: effectiveTimeLimit,
    rotationIntervalSeconds: effectiveRotationSec,
    rotationIntervalMs: effectiveRotationMs,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const initialInterval = Math.floor(issuedAtMillis / effectiveRotationMs);
  const initialToken = computeLectureQrToken(sessionSecret, initialInterval);

  return {
    bingoId: bingoRef.id,
    roundId,
    sessionSecret,
    rotationIntervalSeconds: effectiveRotationSec,
    rotationIntervalMs: effectiveRotationMs,
    issuedAtMillis,
    expiresAtMillis,
    timeLimitSeconds: effectiveTimeLimit,
    initialToken,
  };
}

/**
 * 16.2 Get Lecture Passkey Auth Options (Mobile Phone Scanned QR)
 */
export async function handleGetLecturePasskeyAuthOptions({ classId, bingoId, token, clientRpId }) {
  if (!classId || !bingoId || !token) {
    throw new HttpsError('invalid-argument', 'Missing classId, bingoId, or rotating token.');
  }

  const bingoRef = db.doc(`classes/${classId}/bingoRecords/${bingoId}`);
  const bingoDoc = await bingoRef.get();

  if (!bingoDoc.exists) {
    throw new HttpsError('not-found', 'Lecture attendance challenge not found.');
  }

  const bingoData = bingoDoc.data();
  if (bingoData.status === 'completed' || bingoData.status === 'cancelled') {
    throw new HttpsError('failed-precondition', 'This attendance check has ended.');
  }

  if (Date.now() > bingoData.expiresAtMillis + 15000) {
    throw new HttpsError('deadline-exceeded', 'This lecture attendance challenge has expired.');
  }

  // Validate rotating QR token against session secret with configured rotation interval
  const rotationIntervalMs = bingoData.rotationIntervalMs || (bingoData.rotationIntervalSeconds ? bingoData.rotationIntervalSeconds * 1000 : DEFAULT_LECTURE_QR_ROTATION_INTERVAL_MS);
  if (!isValidLectureQrToken(bingoData.sessionSecret, token, Date.now(), rotationIntervalMs)) {
    throw new HttpsError(
      'invalid-argument',
      'Expired or invalid QR code. Please scan the current live QR code displayed on the lecture screen.'
    );
  }

  const rpID = resolveRpId(clientRpId);

  // Generate WebAuthn authentication options with userVerification: 'required' (Face ID / Fingerprint)
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [], // Allows device to use its resident hardware passkey
    userVerification: 'required',
  });

  const challengeId = crypto.randomUUID();
  const challengeExpiresAtMillis = Date.now() + 2 * 60 * 1000; // 2 minutes

  await db.doc(`classes/${classId}/bingoRecords/${bingoId}/challenges/${challengeId}`).set({
    challengeId,
    challenge: options.challenge,
    token,
    rpIdUsed: rpID,
    createdAt: FieldValue.serverTimestamp(),
    expiresAtMillis: challengeExpiresAtMillis,
  });

  return {
    options,
    challengeId,
    bingoId,
    classId,
    expiresAtMillis: bingoData.expiresAtMillis,
    timeLimitSeconds: bingoData.timeLimitSeconds,
  };
}

/**
 * 16.3 Verify Lecture Passkey Auth (Mobile Phone Assertion Submission)
 */
export async function handleVerifyLecturePasskeyAuth({
  classId,
  bingoId,
  challengeId,
  token,
  assertionResponse,
  clientRpId,
  timeToCompleteMillis,
  deviceFingerprint,
}) {
  if (!classId || !bingoId || !challengeId || !assertionResponse) {
    throw new HttpsError('invalid-argument', 'Missing verification parameters.');
  }

  const bingoRef = db.doc(`classes/${classId}/bingoRecords/${bingoId}`);
  const bingoDoc = await bingoRef.get();

  if (!bingoDoc.exists) {
    throw new HttpsError('not-found', 'Lecture attendance record not found.');
  }

  const bingoData = bingoDoc.data();
  if (bingoData.status === 'cancelled') {
    throw new HttpsError('failed-precondition', 'This attendance challenge was cancelled by the instructor.');
  }

  // Retrieve challenge doc
  const challengeRef = db.doc(`classes/${classId}/bingoRecords/${bingoId}/challenges/${challengeId}`);
  const challengeDoc = await challengeRef.get();

  if (!challengeDoc.exists) {
    throw new HttpsError('failed-precondition', 'Challenge expired or not found. Please scan the QR code again.');
  }

  const challengeData = challengeDoc.data();
  if (Date.now() > challengeData.expiresAtMillis) {
    throw new HttpsError('deadline-exceeded', 'Verification challenge expired.');
  }

  // Validate token if provided or stored in challenge
  const tokenToVerify = token || challengeData.token;
  const rotationIntervalMs = bingoData.rotationIntervalMs || (bingoData.rotationIntervalSeconds ? bingoData.rotationIntervalSeconds * 1000 : DEFAULT_LECTURE_QR_ROTATION_INTERVAL_MS);
  if (!isValidLectureQrToken(bingoData.sessionSecret, tokenToVerify, Date.now(), rotationIntervalMs)) {
    throw new HttpsError(
      'invalid-argument',
      'The scanned QR token has expired. Please scan the current code on the screen.'
    );
  }

  // Identify student passkey by assertion credential ID
  const credentialID = assertionResponse.id;
  const passkeySnap = await db.collection('studentPasskeys')
    .where('credentialID', '==', credentialID)
    .limit(1)
    .get();

  if (passkeySnap.empty) {
    throw new HttpsError(
      'not-found',
      'This phone passkey is not paired with any student account in the system. Please pair your phone with your account first.'
    );
  }

  const studentPasskeyDoc = passkeySnap.docs[0];
  const passkeyData = studentPasskeyDoc.data();
  const studentUid = passkeyData.studentUid || studentPasskeyDoc.id;
  const studentEmail = passkeyData.studentEmail || '';

  // Check hardware device fingerprint if registered
  if (passkeyData.deviceFingerprint && deviceFingerprint && passkeyData.deviceFingerprint !== deviceFingerprint) {
    console.warn(`[verifyLecturePasskeyAuth] Device mismatch for student ${studentEmail}! Registered: ${passkeyData.deviceFingerprint}, scanned: ${deviceFingerprint}`);
    throw new HttpsError('permission-denied', 'Device Mismatch: Attendance must be verified using your registered phone.');
  }

  const expectedChallenge = challengeData.challenge;
  const rpID = resolveRpId(clientRpId || challengeData.rpIdUsed);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: ALLOWED_ORIGINS,
      expectedRPID: ALLOWED_RP_IDS,
      credential: {
        id: passkeyData.credentialID,
        publicKey: new Uint8Array(Buffer.from(passkeyData.credentialPublicKey, 'base64')),
        counter: passkeyData.counter || 0,
        transports: passkeyData.transports,
      },
      requireUserVerification: true,
    });
  } catch (err) {
    console.error('[verifyLecturePasskeyAuth] WebAuthn assertion verification failed:', err);
    throw new HttpsError('invalid-argument', `Biometric verification failed: ${err.message}`);
  }

  if (!verification.verified) {
    throw new HttpsError('invalid-argument', 'Passkey biometric assertion was not valid.');
  }

  // Update passkey counter and last used timestamp
  await studentPasskeyDoc.ref.update({
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: FieldValue.serverTimestamp(),
  });

  const responseTimeSec = timeToCompleteMillis
    ? Math.max(0.1, Math.round(Number(timeToCompleteMillis) / 100) / 10)
    : Math.max(0.1, Math.round((Date.now() - bingoData.issuedAtMillis) / 100) / 10);

  // Check if student already checked in
  const existingResponses = bingoData.responses || {};
  if (existingResponses[studentUid]) {
    return {
      verified: true,
      alreadyVerified: true,
      studentUid,
      studentEmail,
      responseTimeSec: existingResponses[studentUid].responseTimeSec || responseTimeSec,
      pointsAwarded: existingResponses[studentUid].pointsAwarded || 10,
    };
  }

  // Compute live rank
  const currentVerifiedCount = Object.keys(existingResponses).length + 1;

  // Record response in lecture session document
  const responseData = {
    studentUid,
    studentEmail,
    verifiedAt: FieldValue.serverTimestamp(),
    verifiedAtMillis: Date.now(),
    responseTimeSec,
    rank: currentVerifiedCount,
    passkeyVerified: true,
    pointsAwarded: 10,
    deviceModel: passkeyData.deviceModel || 'Mobile Device',
  };

  await bingoRef.update({
    [`responses.${studentUid}`]: responseData,
    verifiedStudentsCount: FieldValue.increment(1),
  });

  // Create an individual student record in bingoRecords for reporting & student dashboard views
  const individualDocRef = db.collection(`classes/${classId}/bingoRecords`).doc(`${bingoId}_${studentUid}`);
  await individualDocRef.set({
    id: individualDocRef.id,
    parentBingoId: bingoId,
    roundId: bingoData.roundId,
    classId,
    studentUid,
    studentEmail,
    question: bingoData.question,
    options: bingoData.options,
    correctIndex: 0,
    selectedIndex: 0,
    selectedOptionText: 'Biometric QR Check-In Verified',
    result: 'passed',
    status: 'completed',
    passkeyVerified: true,
    responseTimeSec,
    rank: currentVerifiedCount,
    pointsAwarded: 10,
    questionSource: 'lecture_passkey_qr',
    triggerType: 'teacher_lecture_qr',
    strikeNumber: 1,
    issuedAt: bingoData.issuedAt || FieldValue.serverTimestamp(),
    issuedAtMillis: bingoData.issuedAtMillis,
    answeredAt: FieldValue.serverTimestamp(),
    timeLimitSeconds: bingoData.timeLimitSeconds,
  });

  // Update Student Active Bingo Realtime State
  try {
    await db.doc(`classes/${classId}/studentProperties/${studentUid}`).set({
      activeBingo: {
        bingoId,
        roundId: bingoData.roundId,
        classId,
        question: bingoData.question,
        options: bingoData.options,
        status: 'completed',
        result: 'passed',
        passkeyVerified: true,
        responseTimeSec,
        rank: currentVerifiedCount,
        pointsAwarded: 10,
        questionSource: 'lecture_passkey_qr',
      },
    }, { merge: true });
  } catch (propErr) {
    console.warn('[verifyLecturePasskeyAuth] Failed to update student activeBingo:', propErr);
  }

  return {
    verified: true,
    studentUid,
    studentEmail,
    responseTimeSec,
    rank: currentVerifiedCount,
    pointsAwarded: 10,
  };
}

