import './firebase.js';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onUserCreate as onUserCreateHandler } from 'firebase-functions/v2/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';

const db = getFirestore();
const adminAuth = getAuth();

// Helper function to manage user-class associations
const updateUserAssociations = async (classId, emails, userType, action) => {
  const promises = [];
  const profileCollection = userType === 'student' ? 'studentProfiles' : 'teacherProfiles';
  const uidArrayField = userType === 'student' ? 'studentUids' : 'teacherUids';
  const firestoreAction = action === 'add' ? FieldValue.arrayUnion : FieldValue.arrayRemove;

  for (const email of emails) {
    try {
      const userRecord = await adminAuth.getUserByEmail(email);
      const userDocRef = db.collection(profileCollection).doc(userRecord.uid);
      const classDocRef = db.collection('classes').doc(classId);

      // Update the user's profile with the classId
      promises.push(userDocRef.set({ classes: firestoreAction(classId) }, { merge: true }));

      // Update the class document with the user's UID
      promises.push(classDocRef.update({ [uidArrayField]: firestoreAction(userRecord.uid) }));

      logger.info(`${action === 'add' ? 'Linked' : 'Unlinked'} class '${classId}' for ${userType} ${userRecord.uid} (${email})`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        logger.info(`User with email '${email}' not found. They will be fully enrolled once they sign up.`);
      } else {
        logger.error(`Error finding user '${email}' to ${action} class '${classId}':`, error);
      }
    }
  }
  return Promise.all(promises);
};

export const onClassUpdate = onDocumentWritten('classes/{classId}', async (event) => {
  const classId = event.params.classId;
  const beforeData = event.data.before.data() || {};
  const afterData = event.data.after.data() || {};

  // Handle Students
  const studentsBefore = new Set(beforeData.students || []);
  const studentsAfter = new Set(afterData.students || []);
  const addedStudents = [...studentsAfter].filter(email => !studentsBefore.has(email));
  const removedStudents = [...studentsBefore].filter(email => !studentsAfter.has(email));

  // Handle Teachers
  const teachersBefore = new Set(beforeData.teachers || []);
  const teachersAfter = new Set(afterData.teachers || []);
  const addedTeachers = [...teachersAfter].filter(email => !teachersBefore.has(email));
  const removedTeachers = [...teachersBefore].filter(email => !teachersAfter.has(email));

  const promises = [
    updateUserAssociations(classId, addedStudents, 'student', 'add'),
    updateUserAssociations(classId, removedStudents, 'student', 'remove'),
    updateUserAssociations(classId, addedTeachers, 'teacher', 'add'),
    updateUserAssociations(classId, removedTeachers, 'teacher', 'remove'),
  ];

  return Promise.all(promises);
});

export const onUserCreate = onUserCreateHandler(async (user) => {
    const { uid, email, customClaims } = user;

    if (!email) {
        logger.warn(`User ${uid} created without an email address.`);
        return;
    }

    const isTeacher = customClaims && customClaims.role === 'teacher';
    const profileCollection = isTeacher ? 'teacherProfiles' : 'studentProfiles';
    const emailField = isTeacher ? 'teachers' : 'students';
    const uidField = isTeacher ? 'teacherUids' : 'studentUids';

    logger.info(`New ${isTeacher ? 'teacher' : 'student'} signed up: ${email} (${uid}). Checking for pre-enrolled classes.`);

    const classesRef = db.collection('classes');
    const querySnapshot = await classesRef.where(emailField, 'array-contains', email).get();

    if (querySnapshot.empty) {
        logger.info(`No pre-enrolled classes found for ${email}.`);
        return;
    }

    const batch = db.batch();

    querySnapshot.forEach(doc => {
        const classId = doc.id;
        logger.info(`Found matching class '${classId}'. Linking user.`);

        // Add classId to the user's profile
        const userProfileRef = db.collection(profileCollection).doc(uid);
        batch.set(userProfileRef, { classes: FieldValue.arrayUnion(classId) }, { merge: true });

        // Add UID to the class's UID array
        const classRef = doc.ref;
        batch.update(classRef, { [uidField]: FieldValue.arrayUnion(uid) });
    });

    await batch.commit();
    logger.info(`Successfully linked ${email} to ${querySnapshot.size} class(es).`);
});