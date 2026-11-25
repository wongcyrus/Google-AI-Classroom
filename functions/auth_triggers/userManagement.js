import './firebase.js';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';
import { FUNCTION_REGION, CORS_ORIGINS, deriveUserRole, getAllowedEmailDomainsDescription } from './config.js';

const db = getFirestore();
const adminAuth = getAuth();

const sanitizeEmailList = (arr) =>
  Array.isArray(arr) ? arr.map((e) => (typeof e === 'string' ? e.replace(/\s/g, '') : '')).filter(Boolean) : [];

// Helper function to get or create multiple users in bulk, ensuring one UID per email.
const getOrCreateUsers = async (emails, userType) => {
    const expectedRole = userType === 'student' ? 'student' : 'teacher';
    const tasks = [];

    for (const email of emails) {
        if (!email) continue;

        const derivedRole = deriveUserRole(email);
        if (!derivedRole) {
            logger.warn(`Invalid institutional email domain for '${email}'. Skipping.`);
            continue;
        }

        if (derivedRole !== expectedRole) {
            logger.warn(`Email '${email}' has a domain for a '${derivedRole}' but was added to a list for '${expectedRole}'. Skipping.`);
            continue;
        }

        tasks.push(async () => {
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
        });
    }

    // Bound Auth API concurrency to avoid quota spikes/429s during large class imports
    const AUTH_CONCURRENCY = 15;
    const results = [];
    for (let i = 0; i < tasks.length; i += AUTH_CONCURRENCY) {
      const chunk = tasks.slice(i, i + AUTH_CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map((fn) => fn()));
      results.push(...chunkResults);
    }
    return results.filter(Boolean);
};


// Helper function to manage user-class associations in bulk
const updateUserAssociations = async (classId, emails, userType, action, studentProfiles = {}, options = {}) => {
  if (!emails || emails.length === 0) {
    return;
  }

  const { skipClassDocUpdate = false } = options;
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

  // Cross-class auto-enrichment: check central studentDirectory for any student missing a profile
  const directoryBackfills = {};
  if (action === 'add' && userType === 'student') {
    const missingProfileEmails = Array.from(new Set(
      userRecords
        .map(u => (u.email ? u.email.trim().toLowerCase() : ''))
        .filter(e => e && (!studentProfiles[e] || !studentProfiles[e].studentName))
    ));

    if (missingProfileEmails.length > 0) {
      const READ_CHUNK = 100;
      for (let i = 0; i < missingProfileEmails.length; i += READ_CHUNK) {
        const chunkEmails = missingProfileEmails.slice(i, i + READ_CHUNK);
        const dirRefs = chunkEmails.map((normEmail) => db.collection('studentDirectory').doc(normEmail));
        try {
          let snaps;
          if (typeof db.getAll === 'function') {
            snaps = await db.getAll(...dirRefs);
          } else {
            snaps = await Promise.all(dirRefs.map((ref) => ref.get().catch(() => null)));
          }
          (snaps || []).forEach((dirSnap, idx) => {
            if (!dirSnap?.exists) return;
            const normEmail = chunkEmails[idx];
            const dirData = dirSnap.data() || {};
            if (dirData.studentName) {
              directoryBackfills[normEmail] = {
                studentName: dirData.studentName || '',
                nickname: dirData.nickname || '',
                programme: dirData.programme || '',
                studentClass: dirData.studentClass || '',
              };
              logger.info(`Auto-backfilled profile for ${normEmail} from central studentDirectory.`);
            }
          });
        } catch (dirErr) {
          logger.warn(`Could not check studentDirectory batch for class ${classId}:`, dirErr);
        }
      }
    }
  }

  const BATCH_LIMIT = 400;
  const classDocRef = db.collection('classes').doc(classId);
  const classUpdatePayload = {};
  let batch = db.batch();
  let batchOpCount = 0;

  const commitAndResetBatch = async () => {
    if (batchOpCount > 0) {
      await batch.commit();
      batch = db.batch();
      batchOpCount = 0;
    }
  };

  for (const userRecord of userRecords) {
    if (batchOpCount >= BATCH_LIMIT - 2) {
      await commitAndResetBatch();
    }

    const userDocRef = db.collection(profileCollection).doc(userRecord.uid);

    // Update the user's profile with the classId
    batch.set(userDocRef, { classes: firestoreAction(classId) }, { merge: true });
    batchOpCount++;

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
        const normEmail = userRecord.email ? userRecord.email.trim().toLowerCase() : '';
        const profileData = studentProfiles[normEmail] || directoryBackfills[normEmail] || {};
        batch.set(studentPropsRef, { ...classProps, ...profileData }, { merge: true });
        batchOpCount++;
      } else {
        classUpdatePayload[`students.${userRecord.uid}`] = FieldValue.delete();
      }
    }
    logger.info(`${action === 'add' ? 'Linked' : 'Unlinked'} class '${classId}' for ${userType} ${userRecord.uid} (${userRecord.email})`);
  }

  // If profiles were backfilled from central studentDirectory, patch class document's studentProfiles
  if (!skipClassDocUpdate && Object.keys(directoryBackfills).length > 0) {
    for (const [normEmail, bProfile] of Object.entries(directoryBackfills)) {
      classUpdatePayload[`studentProfiles.${normEmail}`] = {
        ...bProfile,
        updatedAt: new Date().toISOString(),
      };
    }
  }
  
  if (!skipClassDocUpdate && Object.keys(classUpdatePayload).length > 0) {
    if (batchOpCount >= BATCH_LIMIT) {
      await commitAndResetBatch();
    }
    batch.update(classDocRef, classUpdatePayload);
    batchOpCount++;
  }

  await commitAndResetBatch();
  logger.info(`Batch committed for ${userRecords.length} ${userType}(s) association changes in class ${classId}.`);
};

export const onClassUpdate = onDocumentWritten({ document: 'classes/{classId}', region: FUNCTION_REGION }, async (event) => {
  const classId = event.params.classId;
  const beforeData = event.data.before.data() || {};
  const afterSnap = event.data?.after;
  const afterData = afterSnap?.data?.() || {};
  const afterExists = typeof afterSnap?.exists === 'function'
    ? afterSnap.exists()
    : (typeof afterSnap?.exists === 'boolean' ? afterSnap.exists : Boolean(afterSnap?.data?.()));

  // Handle Students (normalize both before & after identically so whitespace differences don't churn associations)
  const originalStudentEmails = Array.isArray(afterData.studentEmails) ? afterData.studentEmails : [];
  const cleanedStudentEmails = sanitizeEmailList(originalStudentEmails);

  const studentsBefore = new Set(sanitizeEmailList(beforeData.studentEmails));
  const studentsAfter = new Set(afterExists ? cleanedStudentEmails : []);
  const addedStudents = [...studentsAfter].filter(email => !studentsBefore.has(email));
  const removedStudents = [...studentsBefore].filter(email => !studentsAfter.has(email));

  // Handle Teachers
  const teachersBefore = new Set(sanitizeEmailList(beforeData.teacherEmails));
  const teachersAfter = new Set(afterExists ? sanitizeEmailList(afterData.teacherEmails) : []);
  const addedTeachers = [...teachersAfter].filter(email => !teachersBefore.has(email));
  const removedTeachers = [...teachersBefore].filter(email => !teachersAfter.has(email));

  // Fast-path early return for status-only updates (e.g. isCapturing, aiUsedQuota, lastAutoBingoAt)
  const beforeProfiles = (beforeData.studentProfiles && typeof beforeData.studentProfiles === 'object') ? beforeData.studentProfiles : {};
  const afterProfiles = (afterData.studentProfiles && typeof afterData.studentProfiles === 'object') ? afterData.studentProfiles : {};
  const needsEmailSanitization = afterExists && JSON.stringify(originalStudentEmails) !== JSON.stringify(cleanedStudentEmails);

  if (
    addedStudents.length === 0 &&
    removedStudents.length === 0 &&
    addedTeachers.length === 0 &&
    removedTeachers.length === 0 &&
    !needsEmailSanitization &&
    (!afterExists || JSON.stringify(beforeProfiles) === JSON.stringify(afterProfiles))
  ) {
    return null;
  }

  const promises = [
    updateUserAssociations(classId, addedStudents, 'student', 'add', afterData.studentProfiles || {}),
    updateUserAssociations(classId, removedStudents, 'student', 'remove', {}, { skipClassDocUpdate: !afterExists }),
    updateUserAssociations(classId, addedTeachers, 'teacher', 'add'),
    updateUserAssociations(classId, removedTeachers, 'teacher', 'remove', {}, { skipClassDocUpdate: !afterExists }),
  ];

  // Sync only added/changed student profiles to the central institutional studentDirectory
  if (afterExists && afterData.studentProfiles && typeof afterData.studentProfiles === 'object') {
    let dirBatch = db.batch();
    let dirCount = 0;
    for (const [rawEmail, prof] of Object.entries(afterData.studentProfiles)) {
      const normEmail = rawEmail.trim().toLowerCase();
      if (!normEmail || !prof || typeof prof !== 'object') continue;
      if (!prof.studentName && !prof.nickname && !prof.programme && !prof.studentClass) continue;

      const prevProf = beforeProfiles[rawEmail];
      if (
        prevProf &&
        typeof prevProf === 'object' &&
        (prevProf.studentName || '') === (prof.studentName || '') &&
        (prevProf.nickname || '') === (prof.nickname || '') &&
        (prevProf.programme || '') === (prof.programme || '') &&
        (prevProf.studentClass || '') === (prof.studentClass || '')
      ) {
        continue;
      }

      const dirRef = db.collection('studentDirectory').doc(normEmail);
      dirBatch.set(dirRef, {
        email: normEmail,
        studentName: prof.studentName || '',
        nickname: prof.nickname || '',
        programme: prof.programme || '',
        studentClass: prof.studentClass || '',
        lastUpdatedByClass: classId,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      dirCount++;

      if (dirCount >= 450) {
        promises.push(dirBatch.commit());
        dirBatch = db.batch();
        dirCount = 0;
      }
    }
    if (dirCount > 0) {
      promises.push(dirBatch.commit());
    }
  }

  // If the student emails were cleaned, update the document to store the clean version.
  if (needsEmailSanitization) {
    logger.info(`Sanitizing studentEmails array for class ${classId}.`);
    const classRef = db.collection('classes').doc(classId);
    promises.push(classRef.update({ studentEmails: cleanedStudentEmails }));
  }

  return Promise.all(promises);
});

export async function handleBeforeUserCreatedLogic(event, customDeps = {}) {
  const currentDb = customDeps.db || db;
  const currentDeriveRole = customDeps.deriveUserRole || deriveUserRole;
  const currentGetAllowed = customDeps.getAllowedEmailDomainsDescription || getAllowedEmailDomainsDescription;
  const currentFieldValue = customDeps.FieldValue || FieldValue;

  const user = event?.data;
  const { uid, email } = user || {};

  if (!email) {
    throw new HttpsError('invalid-argument', 'Email is required to sign up.');
  }

  const classesRef = currentDb.collection('classes');

  // Check if this email was pre-registered as a teacher in any existing class
  const teacherPreEnrollSnapshot = await classesRef.where('teacherEmails', 'array-contains', email).limit(1).get();
  const isPreEnrolledTeacher = !teacherPreEnrollSnapshot.empty;

  let derivedRole = isPreEnrolledTeacher ? 'teacher' : currentDeriveRole(email);
  if (!derivedRole) {
    throw new HttpsError('invalid-argument', `Please use a valid institutional email address (${currentGetAllowed()}).`);
  }

  const isTeacher = (derivedRole === 'teacher');
  const newCustomClaims = { role: derivedRole };

  const profileCollection = isTeacher ? 'teacherProfiles' : 'studentProfiles';
  const emailField = isTeacher ? 'teacherEmails' : 'studentEmails';

  logger.info(`New ${isTeacher ? 'teacher' : 'student'} signed up: ${email} (${uid})${isPreEnrolledTeacher ? ' [Pre-enrolled Teacher]' : ''}. Checking for pre-enrolled classes.`);

  const querySnapshot = await classesRef.where(emailField, 'array-contains', email).get();

  const batch = currentDb.batch();
  const userProfileRef = currentDb.collection(profileCollection).doc(uid);
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
    profileData.classes = currentFieldValue.arrayUnion(...classIds);
  }
  batch.set(userProfileRef, profileData, { merge: true });

  await batch.commit();
  logger.info(`User profile and class links committed for ${email}.`);

  return {
    customClaims: newCustomClaims
  };
}

export const beforeusercreated = beforeUserCreated({ region: FUNCTION_REGION }, async (event) => {
  return handleBeforeUserCreatedLogic(event);
});

export async function handleGetAllSystemStudentEmailsLogic(request, customDeps = {}) {
  const currentAuth = customDeps.adminAuth || adminAuth;
  const currentDb = customDeps.db || db;
  const currentDeriveRole = customDeps.deriveUserRole || deriveUserRole;

  if (!request?.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerEmail = request.auth.token?.email || '';
  const callerRole = request.auth.token?.role || currentDeriveRole(callerEmail);

  if (callerRole !== 'teacher' && callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Only teachers can access the system student directory.');
  }

  const studentEmailsSet = new Set();
  const studentProfilesMap = {};

  const selectFields = (colRef, ...fields) => (
    typeof colRef?.select === 'function' ? colRef.select(...fields) : colRef
  );

  // Fetch all 4 sources in parallel with field projection to cut latency and memory usage
  const [studentDirSnap, authStudentEmails, classesSnap, studentProfilesSnap] = await Promise.all([
    // 1. Central studentDirectory collection
    selectFields(
      currentDb.collection('studentDirectory'),
      'email', 'studentName', 'nickname', 'programme', 'studentClass'
    ).get().catch((dirErr) => {
      logger.warn('Error querying studentDirectory:', dirErr);
      return null;
    }),

    // 2. Firebase Auth users paginated list
    (async () => {
      const emails = [];
      try {
        let nextPageToken;
        do {
          const listUsersResult = await currentAuth.listUsers(1000, nextPageToken);
          for (const userRecord of listUsersResult.users) {
            if (!userRecord.email) continue;
            const role = userRecord.customClaims?.role || currentDeriveRole(userRecord.email);
            if (role === 'student') {
              emails.push(userRecord.email.trim().toLowerCase());
            }
          }
          nextPageToken = listUsersResult.pageToken;
        } while (nextPageToken);
      } catch (authErr) {
        logger.warn('Error listing users from auth:', authErr);
      }
      return emails;
    })(),

    // 3. Classes collection (optionally teacher-scoped when requested)
    (async () => {
      try {
        let classesQuery = currentDb.collection('classes');
        const normalizedCallerEmail = callerEmail.trim().toLowerCase();
        if (request.data?.teacherScoped === true && callerRole !== 'admin' && normalizedCallerEmail && typeof classesQuery.where === 'function') {
          classesQuery = classesQuery.where('teacherEmails', 'array-contains', normalizedCallerEmail);
        }
        return await selectFields(classesQuery, 'studentEmails', 'students', 'studentProfiles').get();
      } catch (fsErr) {
        logger.warn('Error querying classes for student emails:', fsErr);
        return null;
      }
    })(),

    // 4. StudentProfiles collection
    selectFields(
      currentDb.collection('studentProfiles'),
      'email', 'studentName', 'nickname', 'programme', 'studentClass'
    ).get().catch((spErr) => {
      logger.warn('Error querying studentProfiles for student emails:', spErr);
      return null;
    }),
  ]);

  // Merge in deterministic priority order: studentDirectory -> Auth -> classes -> studentProfiles
  if (studentDirSnap && typeof studentDirSnap.forEach === 'function') {
    studentDirSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const email = (data.email || docSnap.id).trim().toLowerCase();
      if (email && email.includes('@')) {
        studentEmailsSet.add(email);
        studentProfilesMap[email] = {
          studentName: data.studentName || '',
          nickname: data.nickname || '',
          programme: data.programme || '',
          studentClass: data.studentClass || '',
        };
      }
    });
  }

  authStudentEmails.forEach((em) => studentEmailsSet.add(em));

  if (classesSnap && typeof classesSnap.forEach === 'function') {
    classesSnap.forEach((docSnap) => {
      const classData = docSnap.data();
      if (Array.isArray(classData.studentEmails)) {
        classData.studentEmails.forEach((e) => {
          if (typeof e === 'string' && e.includes('@')) {
            studentEmailsSet.add(e.trim().toLowerCase());
          }
        });
      }
      if (classData.students && typeof classData.students === 'object') {
        Object.values(classData.students).forEach((e) => {
          if (typeof e === 'string' && e.includes('@')) {
            studentEmailsSet.add(e.trim().toLowerCase());
          }
        });
      }
      if (classData.studentProfiles && typeof classData.studentProfiles === 'object') {
        for (const [rawE, prof] of Object.entries(classData.studentProfiles)) {
          const normE = rawE.trim().toLowerCase();
          if (normE && prof && typeof prof === 'object') {
            studentEmailsSet.add(normE);
            if (!studentProfilesMap[normE] || !studentProfilesMap[normE].studentName) {
              studentProfilesMap[normE] = {
                studentName: prof.studentName || '',
                nickname: prof.nickname || '',
                programme: prof.programme || '',
                studentClass: prof.studentClass || '',
              };
            }
          }
        }
      }
    });
  }

  if (studentProfilesSnap && typeof studentProfilesSnap.forEach === 'function') {
    studentProfilesSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.email && typeof data.email === 'string' && data.email.includes('@')) {
        const normE = data.email.trim().toLowerCase();
        studentEmailsSet.add(normE);
        if (!studentProfilesMap[normE] || !studentProfilesMap[normE].studentName) {
          studentProfilesMap[normE] = {
            studentName: data.studentName || '',
            nickname: data.nickname || '',
            programme: data.programme || '',
            studentClass: data.studentClass || '',
          };
        }
      }
    });
  }

  const sortedStudentEmails = Array.from(studentEmailsSet).sort();
  return {
    studentEmails: sortedStudentEmails,
    studentProfiles: studentProfilesMap,
    total: sortedStudentEmails.length,
  };
}

export const getAllSystemStudentEmails = onCall(
  { region: FUNCTION_REGION, cors: CORS_ORIGINS },
  async (request) => {
    return handleGetAllSystemStudentEmailsLogic(request);
  }
);
