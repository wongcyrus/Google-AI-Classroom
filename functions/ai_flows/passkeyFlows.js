import './firebase.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { HttpsError } from 'firebase-functions/v2/https';
import crypto from 'crypto';

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
 * 1. Request Passkey Pairing Token (Student on Lab PC)
 * Generates a temporary 10-minute token for mobile phone pairing without typing password
 */
export async function handleRequestPasskeyPairingToken({ studentUid, studentEmail, classId }) {
  if (!studentUid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to request pairing token.');
  }

  const tokenId = crypto.randomUUID();
  const expiresAtMillis = Date.now() + 10 * 60 * 1000; // 10 minutes

  await db.doc(`passkeyPairingTokens/${tokenId}`).set({
    tokenId,
    studentUid,
    studentEmail: (studentEmail || '').toLowerCase(),
    classId: classId || null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAtMillis,
    used: false,
  });

  return { tokenId, expiresAtMillis };
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

  // Generate WebAuthn options for registering biometric passkey
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new Uint8Array(Buffer.from(tokenData.studentUid)),
    userName: tokenData.studentEmail || tokenData.studentUid,
    userDisplayName: tokenData.studentEmail ? tokenData.studentEmail.split('@')[0] : 'Student',
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
export async function handleVerifyPasskeyRegistration({ pairingToken, attestationResponse, clientRpId, deviceModel }) {
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
  // Query studentPasskeys to ensure this physical credential is NOT bound to another student!
  // =========================================================================
  const existingSnap = await db.collection('studentPasskeys')
    .where('credentialID', '==', credentialID)
    .get();

  if (!existingSnap.empty) {
    for (const doc of existingSnap.docs) {
      if (doc.id !== tokenData.studentUid) {
        console.warn(`[verifyPasskeyRegistration] Hardware collision detected! Phone credential ${credentialID} already registered to student ${doc.id}`);
        throw new HttpsError(
          'already-exists',
          'This physical mobile device is already registered to another student. Each phone can only be paired with one student account.'
        );
      }
    }
  }

  const credentialPublicKey = Buffer.from(credential.publicKey).toString('base64');
  const transports = credential.transports || attestationResponse.response?.transports || ['internal'];

  // Save the student passkey
  await db.doc(`studentPasskeys/${tokenData.studentUid}`).set({
    studentUid: tokenData.studentUid,
    studentEmail: tokenData.studentEmail,
    credentialID,
    credentialPublicKey,
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
export async function handleVerifyPasskeyAuth({ classId, bingoId, assertionResponse, clientRpId, timeToCompleteMillis }) {
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
