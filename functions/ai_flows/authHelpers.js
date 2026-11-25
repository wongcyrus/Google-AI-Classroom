import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export function isAdminCaller(auth) {
  return auth?.token?.role === 'admin';
}

export function isTeacherRoleCaller(auth) {
  const role = auth?.token?.role;
  return role === 'teacher' || role === 'admin';
}

export function isTeacherInClassData(classData, auth) {
  if (!auth?.uid && !isAdminCaller(auth)) return false;
  if (isAdminCaller(auth)) return true;
  if (!classData || typeof classData !== 'object') return false;

  const uid = auth.uid;
  const email = (auth.token?.email || '').trim().toLowerCase();

  if (uid) {
    if (
      classData.ownerUid === uid ||
      classData.teacherUid === uid ||
      classData.createdBy === uid
    ) {
      return true;
    }
    if (classData.teachers && typeof classData.teachers === 'object' && Boolean(classData.teachers[uid])) {
      return true;
    }
  }

  if (email) {
    if (classData.teacherEmail && String(classData.teacherEmail).trim().toLowerCase() === email) {
      return true;
    }
    if (Array.isArray(classData.teacherEmails)) {
      const matched = classData.teacherEmails.some(
        (e) => typeof e === 'string' && e.trim().toLowerCase() === email
      );
      if (matched) return true;
    }
  }

  return false;
}

export function isStudentInClassData(classData, auth) {
  if (!auth?.uid || !classData || typeof classData !== 'object') return false;
  const uid = auth.uid;
  const email = (auth.token?.email || '').trim().toLowerCase();

  if (classData.students && typeof classData.students === 'object' && classData.students[uid]) {
    return true;
  }
  if (email && Array.isArray(classData.studentEmails)) {
    return classData.studentEmails.some(
      (e) => typeof e === 'string' && e.trim().toLowerCase() === email
    );
  }
  return false;
}

function getClassDocRef(db, classId) {
  if (typeof db?.doc === 'function') {
    return db.doc(`classes/${classId}`);
  }
  return db.collection('classes').doc(classId);
}

export async function assertTeacherInClass(
  auth,
  classId,
  db = getFirestore(),
  deniedMessage = 'Only teachers assigned to this class can perform this action.'
) {
  if (!auth?.uid && !isAdminCaller(auth)) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  if (isAdminCaller(auth)) {
    return {};
  }
  if (!classId || typeof classId !== 'string') {
    throw new HttpsError('invalid-argument', 'classId is required.');
  }
  const classSnap = await getClassDocRef(db, classId).get();
  if (!classSnap?.exists) {
    throw new HttpsError('not-found', `Class ${classId} was not found.`);
  }
  const classData = (typeof classSnap.data === 'function' ? classSnap.data() : classSnap.data) || {};
  if (!isTeacherInClassData(classData, auth)) {
    throw new HttpsError('permission-denied', deniedMessage);
  }
  return classData;
}
