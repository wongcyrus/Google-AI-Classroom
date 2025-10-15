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

// Helper function to get or create multiple users in bulk, ensuring one UID per email.
const getOrCreateUsers = async (emails, userType) => {
    const expectedRole = userType === 'student' ? 'student' : 'teacher';

    const promises = [];

    for (const email of emails) {
        if (!email) continue;

        let derivedRole;
        if (email.endsWith('@vtc.edu.hk')) {
            derivedRole = 'teacher';
        } else if (email.endsWith('@stu.vtc.edu.hk')) {
            derivedRole = 'student';
        } else {
            logger.warn(`Invalid email domain for '${email}'. Skipping.`);
            continue;
        }

        if (derivedRole !== expectedRole) {
            logger.warn(`Email '${email}' has a domain for a '${derivedRole}' but was added to a list for '${expectedRole}'. Skipping.`);
            continue;
        }

        const task = async () => {
            try {
                // 1. Attempt to fetch the user by email.
                const userRecord = await adminAuth.getUserByEmail(email);
                logger.info(`Found existing user for ${email} with UID ${userRecord.uid}.`);

                // 2. Check if the role needs updating.
                if (userRecord.customClaims?.role !== derivedRole) {
                    await adminAuth.setCustomUserClaims(userRecord.uid, { role: derivedRole });
                    logger.info(`Updated role to '${derivedRole}' for existing user ${email}`);
                }
                return userRecord;
            } catch (error) {
                // 3. If user does not exist, create them.
                if (error.code === 'auth/user-not-found') {
                    try {
                        logger.info(`User not found for '${email}'. Creating new user.`);
                        const newUserRecord = await adminAuth.createUser({
                            email,
                            emailVerified: false, // Verification email will be sent by client if needed
                        });
                        await adminAuth.setCustomUserClaims(newUserRecord.uid, { role: derivedRole });
                        logger.info(`Created new user '${email}' with role '${derivedRole}'.`);
                        return newUserRecord;
                    } catch (creationError) {
                        logger.error(`Error creating user '${email}' after not being found:`, creationError);
                        return null;
                    }
                }
                // 4. Handle other errors.
                logger.error(`Error fetching user '${email}':`, error);
                return null;
            }
        };
        promises.push(task());
    }

    // Execute all operations in parallel and filter out any nulls from failures.
    const results = await Promise.all(promises);
    return results.filter(Boolean);
};


// Helper function to manage user-class associations in bulk
const updateUserAssociations = async (classId, emails, userType, action) => {
  if (!emails || emails.length === 0) {
    return;
  }

  const profileCollection = userType === 'student' ? 'studentProfiles' : 'teacherProfiles';
  const firestoreAction = action === 'add' ? FieldValue.arrayUnion : FieldValue.arrayRemove;

  // Pre-fetch class-wide properties if we are adding students
  let classProps = {};
  if (action === 'add' && userType === 'student') {
      try {
          const classPropsRef = db.collection('classes').doc(classId).collection('classProperties').doc('config');
          const classPropsSnap = await classPropsRef.get();
          if (classPropsSnap.exists) {
              classProps = classPropsSnap.data();
              logger.info(`Fetched default properties for class ${classId}.`);
          }
      } catch (e) {
          logger.error(`Could not fetch default properties for class ${classId}`, e);
      }
  }

  const userRecords = await getOrCreateUsers(emails, userType);

  if (userRecords.length === 0) {
    logger.warn(`No valid user records found for ${userType}s in class ${classId} from the provided list.`);
    return;
  }

  const batch = db.batch();
  const classDocRef = db.collection('classes').doc(classId);
  const classUpdatePayload = {};

  for (const userRecord of userRecords) {
    const userDocRef = db.collection(profileCollection).doc(userRecord.uid);

    // Update the user's profile with the classId
    batch.set(userDocRef, { classes: firestoreAction(classId) }, { merge: true });

    if (userType === 'teacher') {
      if (action === 'add') {
        classUpdatePayload[`teachers.${userRecord.uid}`] = userRecord.email;
      } else {
        classUpdatePayload[`teachers.${userRecord.uid}`] = FieldValue.delete();
      }
    } else { // For students
      if (action === 'add') {
        classUpdatePayload[`students.${userRecord.uid}`] = userRecord.email;
        
        const studentPropsRef = classDocRef.collection('studentProperties').doc(userRecord.uid);
        batch.set(studentPropsRef, classProps, { merge: true });
      } else {
        classUpdatePayload[`students.${userRecord.uid}`] = FieldValue.delete();
      }
    }
    logger.info(`${action === 'add' ? 'Linked' : 'Unlinked'} class '${classId}' for ${userType} ${userRecord.uid} (${userRecord.email})`);
  }
  
  if (Object.keys(classUpdatePayload).length > 0) {
    batch.update(classDocRef, classUpdatePayload);
  }

  await batch.commit();
  logger.info(`Batch committed for ${userRecords.length} ${userType}(s) association changes in class ${classId}.`);
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
