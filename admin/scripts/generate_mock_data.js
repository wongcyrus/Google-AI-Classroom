require('dotenv').config({ path: require('path').resolve(__dirname, '../../web-app/.env') });
const admin = require('firebase-admin');
const serviceAccount = require('../sp.json');

// --- CONFIGURATION ---
const MOCK_TEACHERS = [
  { email: 'cywong@vtc.edu.hk', password: 'password', displayName: 'CY Wong' },
];
const MOCK_STUDENTS = [
  { email: 'student1@test.com', password: 'password', displayName: 'Test Student 1' },
  { email: 'student2@test.com', password: 'password', displayName: 'Test Student 2' },
  { email: 'student3@test.com', password: 'password', displayName: 'Test Student 3' },
];
const MOCK_CLASS = {
  id: 'demo-class-101',
  name: 'Demonstration Class 101',
  teachers: MOCK_TEACHERS.map(t => t.email),
  students: MOCK_STUDENTS.map(s => s.email),
};

// --- INITIALIZATION ---
function initializeFirebase() {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.VITE_STORAGE_BUCKET
    });
    console.log('Firebase Admin SDK initialized successfully.');
    return admin;
  } catch (error) {
    if (error.code === 'app/duplicate-app') {
        return admin.app();
    }
    console.error('\nERROR: Could not initialize Firebase Admin SDK.', error);
    process.exit(1);
  }
}

// --- DATA CREATION FUNCTIONS ---

async function createAuthUsers(auth, users) {
    const userRecords = [];
    for (const user of users) {
        try {
            const userRecord = await auth.createUser({
                email: user.email,
                password: user.password,
                displayName: user.displayName,
                emailVerified: true,
            });
            userRecords.push(userRecord);
            console.log(`Successfully created user: ${user.email}`);
        } catch (error) {
            if (error.code === 'auth/email-already-exists') {
                console.log(`User already exists: ${user.email}`);
                const userRecord = await auth.getUserByEmail(user.email);
                userRecords.push(userRecord);
            } else {
                console.error(`Error creating user ${user.email}:`, error);
            }
        }
    }
    return userRecords;
}

async function setTeacherRole(auth, email) {
    try {
        const user = await auth.getUserByEmail(email);
        await auth.setCustomUserClaims(user.uid, { role: 'teacher' });
        console.log(`Successfully set teacher role for: ${email}`);
    } catch (error) {
        console.error(`Error setting teacher role for ${email}:`, error);
    } 
}

async function createFirestoreData(db) {
    console.log('\nCreating Firestore data...');

    // Create class
    try {
        await db.collection('classes').doc(MOCK_CLASS.id).set({
            name: MOCK_CLASS.name,
            teachers: MOCK_CLASS.teachers,
            students: MOCK_CLASS.students,
        });
        console.log(`Successfully created class: ${MOCK_CLASS.id}`);
    } catch (error) {
        console.error(`Error creating class ${MOCK_CLASS.id}:`, error);
    }

    // Create irregularities
    try {
        await db.collection('irregularities').add({
            classId: MOCK_CLASS.id,
            email: MOCK_STUDENTS[0].email,
            title: 'Phone Usage',
            message: 'Student was observed using their phone during the session.',
            imageUrl: 'https://via.placeholder.com/150',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('Successfully created an irregularity record.');
    } catch (error) {
        console.error('Error creating irregularity record:', error);
    }

    // Create progress records
    for (let i = 0; i < 3; i++) {
        for (const student of MOCK_STUDENTS) {
            try {
                await db.collection('progress').add({
                    classId: MOCK_CLASS.id,
                    email: student.email,
                    progress: `This is sample progress report #${i + 1} for ${student.displayName}.`,
                    timestamp: admin.firestore.Timestamp.now(),
                });
            } catch (error) {
                console.error(`Error creating progress record for ${student.email}:`, error);
            }
        }
    }
    console.log('Successfully created progress records.');
}


// --- MAIN EXECUTION ---
async function main() {
  console.log('*****************************************************************');
  console.log('******************  MOCK DATA GENERATION SCRIPT  ******************');
  console.log('*****************************************************************');
  
  const admin = initializeFirebase();
  const auth = admin.auth();
  const db = admin.firestore();

  console.log('\n--- Creating Users ---');
  await createAuthUsers(auth, MOCK_TEACHERS);
  await createAuthUsers(auth, MOCK_STUDENTS);

  console.log('\n--- Setting Custom Claims ---');
  for (const teacher of MOCK_TEACHERS) {
      await setTeacherRole(auth, teacher.email);
  }

  console.log('\n--- Creating Firestore Data ---');
  await createFirestoreData(db);

  console.log('\nMock data generation finished.');
}

main().catch(error => {
  console.error('An unexpected error occurred:', error);
  process.exit(1);
});
