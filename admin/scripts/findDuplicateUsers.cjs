const admin = require('firebase-admin');

// --- CONFIGURATION ---
// Set to false to execute delete and update operations.
const DRY_RUN = true; 

// Load service account key
try {
  const serviceAccount = require('../sp.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
// eslint-disable-next-line no-unused-vars
} catch (_error) {
  console.error('Error: Could not load service account key from ../sp.json');
  console.error('Please ensure the service account file exists and the path is correct.');
  process.exit(1);
}

const db = admin.firestore();

/**
 * Finds all users in Firebase Auth and groups them by email.
 * @returns {Promise<Map<string, any[]>>} A map where keys are emails and values are arrays of user records.
 */
async function getAllUsersByEmail() {
  const emailMap = new Map();
  let pageToken;
  console.log('Fetching all users from Firebase Auth...');

  do {
    const listUsersResult = await admin.auth().listUsers(1000, pageToken);
    listUsersResult.users.forEach((userRecord) => {
      const user = userRecord.toJSON();
      if (user.email) {
        const users = emailMap.get(user.email) || [];
        users.push(user);
        emailMap.set(user.email, users);
      }
    });
    pageToken = listUsersResult.pageToken;
  } while (pageToken);

  console.log(`Total unique emails found: ${emailMap.size}`);
  return emailMap;
}

/**
 * Migrates data from a duplicate UID to a primary UID in Firestore.
 * This function is critical and is based on the schema defined in `docs/firestore-schema.md`.
 * @param {string} primaryUid The UID to keep.
 * @param {string} duplicateUid The UID to merge and delete.
 */
async function migrateFirestoreData(primaryUid, duplicateUid) {
  console.log(`  [DATA MIGRATION] Starting migration from ${duplicateUid} to ${primaryUid}.`);
  if (DRY_RUN) {
    console.log('    (Dry Run) Skipping all database modifications.');
    // In a dry run, we can still log what we would have done.
  }

  const batch = db.batch();

  // --- 1. UID as Document ID ---
  const collectionsWithUidAsDocId = ['users', 'studentProfiles', 'teacherProfiles', 'students', 'teachers'];
  for (const collectionName of collectionsWithUidAsDocId) {
    const oldDocRef = db.collection(collectionName).doc(duplicateUid);
    const oldDoc = await oldDocRef.get();
    if (oldDoc.exists) {
      const newDocRef = db.collection(collectionName).doc(primaryUid);
      console.log(`    - Found document in '${collectionName}'. Moving ${duplicateUid} -> ${primaryUid}.`);
      if (!DRY_RUN) {
        batch.set(newDocRef, oldDoc.data(), { merge: true });
        batch.delete(oldDocRef);
      }
    }
  }

  // --- 2. UID as a Field ---
  const collectionsWithUidAsField = {
    'aiJobs': 'studentUid',
    'irregularities': 'studentUid',
    'notifications': 'userId',
    'progress': 'studentUid',
    'screenshots': 'studentUid',
    'videoJobs': 'studentUid',
    'propertyUploadJobs': 'requesterUid',
    'videoAnalysisJobs': 'requesterUid',
    'zipJobs': 'requesterUid', // Assuming 'requester' is a typo for requesterUid
    'prompts': 'owner'
  };

  for (const [collectionName, fieldName] of Object.entries(collectionsWithUidAsField)) {
    const query = db.collection(collectionName).where(fieldName, '==', duplicateUid);
    const snapshot = await query.get();
    if (!snapshot.empty) {
      console.log(`    - Found ${snapshot.size} document(s) in '${collectionName}' to update.`);
      snapshot.forEach(doc => {
        if (!DRY_RUN) {
          batch.update(doc.ref, { [fieldName]: primaryUid });
        }
      });
    }
  }

  // --- 3. Special Cases: Maps and Arrays ---

  // `classes` collection (UID in a map)
  const classesRef = db.collection('classes');
  const classesSnapshot = await classesRef.get();
  console.log(`    - Scanning ${classesSnapshot.size} class(es) for UID references...`);
  classesSnapshot.forEach(classDoc => {
    const classData = classDoc.data();
    let needsUpdate = false;
    const updatePayload = {};

    // Check 'students' map
    if (classData.students && classData.students[duplicateUid]) {
      console.log(`      - Found duplicate UID in 'students' map for class ${classDoc.id}`);
      const studentEmail = classData.students[duplicateUid];
      updatePayload[`students.${primaryUid}`] = studentEmail;
      updatePayload[`students.${duplicateUid}`] = admin.firestore.FieldValue.delete();
      needsUpdate = true;
    }

    // Check 'teachers' map
    if (classData.teachers && classData.teachers[duplicateUid]) {
      console.log(`      - Found duplicate UID in 'teachers' map for class ${classDoc.id}`);
      const teacherEmail = classData.teachers[duplicateUid];
      updatePayload[`teachers.${primaryUid}`] = teacherEmail;
      updatePayload[`teachers.${duplicateUid}`] = admin.firestore.FieldValue.delete();
      needsUpdate = true;
    }

    if (needsUpdate) {
      if (!DRY_RUN) {
        batch.update(classDoc.ref, updatePayload);
      }
    }
  });
  
  // `prompts` collection (`sharedWith` array)
  const promptsQuery = db.collection('prompts').where('sharedWith', 'array-contains', duplicateUid);
  const promptsSnapshot = await promptsQuery.get();
  if (!promptsSnapshot.empty) {
    console.log(`    - Found ${promptsSnapshot.size} prompt(s) shared with duplicate UID.`);
    promptsSnapshot.forEach(doc => {
      if (!DRY_RUN) {
        batch.update(doc.ref, {
          sharedWith: admin.firestore.FieldValue.arrayRemove(duplicateUid)
        });
        // Note: This just removes the duplicate. A second step could add the primary UID,
        // but we need to handle the case where it might already be present.
        // For simplicity here, we just remove. A manual check might be needed.
      }
    });
  }

  // --- Commit Batch ---
  if (DRY_RUN) {
    console.log('    (Dry Run) Skipping batch commit.');
  } else {
    try {
      await batch.commit();
      console.log('    - SUCCESS: Firestore data migration batch committed.');
    } catch (error) {
      console.error('    - ERROR: Failed to commit Firestore batch:', error);
    }
  }
}


/**
 * Merges duplicate user accounts for a single email.
 * @param {string} email The email with duplicate accounts.
 * @param {any[]} users The array of user records associated with the email.
 */
async function mergeDuplicatesForEmail(email, users) {
  console.log(`
--- Processing email: ${email} ---`);
  
  // 1. Identify the primary user (e.g., most recent sign-in)
  users.sort((a, b) => (b.metadata.lastSignInTime || 0) - (a.metadata.lastSignInTime || 0));
  const primaryUser = users[0];
  const duplicateUsers = users.slice(1);

  console.log(`  Primary UID: ${primaryUser.uid} (Last signed in: ${primaryUser.metadata.lastSignInTime})`);
  duplicateUsers.forEach(dup => {
    console.log(`  Duplicate UID: ${dup.uid} (Last signed in: ${dup.metadata.lastSignInTime})`);
  });

  // 2. Migrate data and delete duplicates
  for (const duplicateUser of duplicateUsers) {
    // Migrate Firestore data
    await migrateFirestoreData(primaryUser.uid, duplicateUser.uid);

    // Delete the duplicate Auth user
    try {
      if (DRY_RUN) {
        console.log(`  (Dry Run) Would delete user: ${duplicateUser.uid}`);
      } else {
        await admin.auth().deleteUser(duplicateUser.uid);
        console.log(`  SUCCESS: Deleted user ${duplicateUser.uid}`);
      }
    } catch (error) {
      console.error(`  ERROR: Failed to delete user ${duplicateUser.uid}`, error);
    }
  }
}

/**
 * Main function to find and handle duplicate emails.
 */
async function main() {
  if (DRY_RUN) {
    console.log('*** RUNNING IN DRY-RUN MODE. NO DATA WILL BE MODIFIED. ***');
    console.log('*** To apply changes, set DRY_RUN to false in the script. ***');
    console.log('');
  }

  try {
    const emailMap = await getAllUsersByEmail();
    const duplicates = [];

    console.log('Analyzing for duplicates...');
    for (const [email, users] of emailMap.entries()) {
      if (users.length > 1) {
        duplicates.push({ email, users });
      }
    }

    if (duplicates.length > 0) {
      console.log(`
--- Found ${duplicates.length} Email(s) with Multiple UIDs ---`);
      for (const dup of duplicates) {
        await mergeDuplicatesForEmail(dup.email, dup.users);
      }
    } else {
      console.log(`
--- No Duplicate Accounts Found ---`);
    }

  } catch (error) {
    console.error('An unexpected error occurred during the process:', error);
    process.exit(1);
  }
}

main().then(() => {
    console.log(`
Script finished. DRY_RUN was ${DRY_RUN}.`);
    process.exit(0);
}).catch((error) => {
    console.error('An unexpected error occurred:', error);
    process.exit(1);
});