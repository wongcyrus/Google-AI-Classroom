import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';

const db = getFirestore();
const adminAuth = getAuth();

export const updateUserClassesOnClassUpdate = onDocumentWritten('classes/{classId}', async (event) => {
  const classId = event.params.classId;
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();

  const studentsBefore = new Set(beforeData.students || []);
  const studentsAfter = new Set(afterData.students || []);

  const addedStudents = [...studentsAfter].filter(email => !studentsBefore.has(email));
  const removedStudents = [...studentsBefore].filter(email => !studentsAfter.has(email));

  const promises = [];

  // Handle added students
  for (const email of addedStudents) {
    try {
      const userRecord = await adminAuth.getUserByEmail(email);
      const userDocRef = db.collection('studentProfiles').doc(userRecord.uid);
      const promise = userDocRef.set({
        classes: FieldValue.arrayUnion(classId)
      }, { merge: true });
      promises.push(promise);
      logger.info(`Added class '${classId}' to user ${userRecord.uid} (${email})`);
    } catch (error) {
      logger.error(`Error finding user '${email}' to add class '${classId}':`, error);
    }
  }

  // Handle removed students
  for (const email of removedStudents) {
    try {
      const userRecord = await adminAuth.getUserByEmail(email);
      const userDocRef = db.collection('studentProfiles').doc(userRecord.uid);
      const promise = userDocRef.update({
        classes: FieldValue.arrayRemove(classId)
      });
      promises.push(promise);
      logger.info(`Removed class '${classId}' from user ${userRecord.uid} (${email})`);
    } catch (error) {
      logger.error(`Error finding user '${email}' to remove class '${classId}':`, error);
    }
  }

  return Promise.all(promises);
});