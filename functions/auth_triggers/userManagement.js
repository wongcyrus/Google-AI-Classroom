import './firebase.js';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();
const adminAuth = getAuth();

// Helper function to get an existing user or create a new one
const getOrCreateUser = async (email, userType) => {
  const expectedRole = userType === 'student' ? 'student' : 'teacher';
  let derivedRole;

  if (email.endsWith('@vtc.edu.hk')) {
    derivedRole = 'teacher';
  } else if (email.endsWith('@stu.vtc.edu.hk')) {
    derivedRole = 'student';
  } else {
    logger.warn(`Invalid email domain for '${email}'. Skipping.`);
    return null;
  }

  if (derivedRole !== expectedRole) {
    logger.warn(`Email '${email}' has a domain for a '${derivedRole}' but was added to a list for '${expectedRole}'. Skipping.`);
    return null;
  }

  try {
    const userRecord = await adminAuth.getUserByEmail(email);
    if (userRecord.customClaims?.role !== derivedRole) {
      await adminAuth.setCustomUserClaims(userRecord.uid, { role: derivedRole });
      logger.info(`Updated role to '${derivedRole}' for existing user ${email}`);
    }
    return userRecord;
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      logger.info(`User with email '${email}' not found. Creating a new user.`);
      try {
        const userRecord = await adminAuth.createUser({
          email,
          emailVerified: false, // User will need to use password reset to login
        });
        await adminAuth.setCustomUserClaims(userRecord.uid, { role: derivedRole });
        logger.info(`Created new user '${email}' with role '${derivedRole}'.`);
        return userRecord;
      } catch (creationError) {
        logger.error(`Error creating user '${email}':`, creationError);
        return null;
      }
    } else {
      logger.error(`Error fetching user '${email}':`, error);
      return null;
    }
  }
};


// Helper function to manage user-class associations
const updateUserAssociations = async (classId, emails, userType, action) => {
  const promises = [];
  const profileCollection = userType === 'student' ? 'studentProfiles' : 'teacherProfiles';
  const firestoreAction = action === 'add' ? FieldValue.arrayUnion : FieldValue.arrayRemove;

  for (const email of emails) {
    const userRecord = await getOrCreateUser(email, userType);

    if (userRecord) {
      const userDocRef = db.collection(profileCollection).doc(userRecord.uid);
      const classDocRef = db.collection('classes').doc(classId);

      // Update the user's profile with the classId
      promises.push(userDocRef.set({ classes: firestoreAction(classId) }, { merge: true }));

      const updatePayload = {};

      if (userType === 'teacher') {
        // For teachers, update the teachers map
        if (action === 'add') {
          updatePayload[`teachers.${userRecord.uid}`] = email;
        } else { // action === 'remove'
          updatePayload[`teachers.${userRecord.uid}`] = FieldValue.delete();
        }
      } else { // For students, update the students map
        if (action === 'add') {
          updatePayload[`students.${userRecord.uid}`] = email;
        } else { // action === 'remove'
          updatePayload[`students.${userRecord.uid}`] = FieldValue.delete();
        }
      }
      
      promises.push(classDocRef.update(updatePayload));

      logger.info(`${action === 'add' ? 'Linked' : 'Unlinked'} class '${classId}' for ${userType} ${userRecord.uid} (${email})`);
    } else {
        logger.error(`Could not get or create user for email '${email}'. Skipping association for class '${classId}'.`);
    }
  }
  return Promise.all(promises);
};

export const onClassUpdate = onDocumentWritten({ document: 'classes/{classId}', region: FUNCTION_REGION }, async (event) => {
  const classId = event.params.classId;
  const beforeData = event.data.before.data() || {};
  const afterData = event.data.after.data() || {};

  // Handle Students
  const originalStudentEmails = afterData.studentEmails || [];
  const cleanedStudentEmails = originalStudentEmails.map(e => e.replace(/\s/g, '')).filter(Boolean);

  const studentsBefore = new Set(beforeData.studentEmails || []);
  const studentsAfter = new Set(cleanedStudentEmails);
  const addedStudents = [...studentsAfter].filter(email => !studentsBefore.has(email));
  const removedStudents = [...studentsBefore].filter(email => !studentsAfter.has(email));

  // Handle Teachers
  const teachersBefore = new Set(beforeData.teacherEmails || []);
  const teachersAfter = new Set(afterData.teacherEmails || []);
  const addedTeachers = [...teachersAfter].filter(email => !teachersBefore.has(email));
  const removedTeachers = [...teachersBefore].filter(email => !teachersAfter.has(email));

  const promises = [
    updateUserAssociations(classId, addedStudents, 'student', 'add'),
    updateUserAssociations(classId, removedStudents, 'student', 'remove'),
    updateUserAssociations(classId, addedTeachers, 'teacher', 'add'),
    updateUserAssociations(classId, removedTeachers, 'teacher', 'remove'),
  ];

  // If the student emails were cleaned, update the document to store the clean version.
  if (JSON.stringify(originalStudentEmails) !== JSON.stringify(cleanedStudentEmails)) {
    logger.info(`Sanitizing studentEmails array for class ${classId}.`);
    const classRef = db.collection('classes').doc(classId);
    promises.push(classRef.update({ studentEmails: cleanedStudentEmails }));
  }

  return Promise.all(promises);
});

export const beforeusercreated = beforeUserCreated({ region: FUNCTION_REGION }, async (event) => {
  const user = event.data;
  const { uid, email } = user;

  if (!email) {
    throw new HttpsError('invalid-argument', 'Email is required to sign up.');
  }

  const newCustomClaims = {};
  let isTeacher = false;

  if (email.endsWith('@vtc.edu.hk')) {
    newCustomClaims.role = 'teacher';
    isTeacher = true;
  } else if (email.endsWith('@stu.vtc.edu.hk')) {
    newCustomClaims.role = 'student';
  } else {
    throw new HttpsError('invalid-argument', 'Please use a valid VTC email address (@vtc.edu.hk or @stu.vtc.edu.hk).');
  }

  const profileCollection = isTeacher ? 'teacherProfiles' : 'studentProfiles';
  const emailField = isTeacher ? 'teacherEmails' : 'studentEmails';

  logger.info(`New ${isTeacher ? 'teacher' : 'student'} signed up: ${email} (${uid}). Checking for pre-enrolled classes.`);

  const classesRef = db.collection('classes');
  const querySnapshot = await classesRef.where(emailField, 'array-contains', email).get();

  const batch = db.batch();
  const userProfileRef = db.collection(profileCollection).doc(uid);
  const classIds = [];

  if (!querySnapshot.empty) {
    querySnapshot.forEach(doc => {
      classIds.push(doc.id);
      const classRef = doc.ref;
      if (isTeacher) {
        batch.update(classRef, { [`teachers.${uid}`]: email });
      } else {
        batch.update(classRef, { [`students.${uid}`]: email });
      }
    });
    logger.info(`Found ${querySnapshot.size} pre-enrolled classes for ${email}, linking them.`);
  } else {
    logger.info(`No pre-enrolled classes found for ${email}.`);
  }

  // Create or merge the user's profile, linking any classes.
  const profileData = {};
  if (classIds.length > 0) {
    profileData.classes = FieldValue.arrayUnion(...classIds);
  }
  batch.set(userProfileRef, profileData, { merge: true });

  await batch.commit();
  logger.info(`User profile and class links committed for ${email}.`);

  return {
    customClaims: newCustomClaims
  };
});
