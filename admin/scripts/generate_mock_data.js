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

const today = new Date();
const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
const endDate = new Date(today.getFullYear(), today.getMonth() + 3, 0); // End of 3 months from now

const MOCK_CLASS = {
  id: 'demo-class-101',
  name: 'Demonstration Class 101',
  teachers: MOCK_TEACHERS.map(t => t.email),
  students: MOCK_STUDENTS.map(s => s.email),
  storageQuota: 5 * 1024 * 1024 * 1024, // 5 GB
  storageUsage: 0,
  schedule: {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    timeSlots: [
      { startTime: '09:00', endTime: '11:00', days: ['Mon', 'Wed'] },
      { startTime: '14:00', endTime: '16:00', days: ['Fri'] }
    ]
  }
};

const MOCK_VIDEOS = [
    {
        name: 'Introduction to Algebra',
        duration: 3600, // 1 hour
        thumbnailUrl: 'https://via.placeholder.com/320x180.png?text=Algebra+Intro',
        videoUrl: 'https://example.com/algebra_intro.mp4',
    },
    {
        name: 'Calculus Basics',
        duration: 5400, // 1.5 hours
        thumbnailUrl: 'https://via.placeholder.com/320x180.png?text=Calculus+Basics',
        videoUrl: 'https://example.com/calculus_basics.mp4',
    }
]

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

async function createFirestoreData(db, users) {
    console.log('\nCreating Firestore data...');

    // Create class
    try {
        const { id, ...classData } = MOCK_CLASS;
        await db.collection('classes').doc(id).set(classData);
        console.log(`Successfully created class: ${MOCK_CLASS.id}`);
    } catch (error) {
        console.error(`Error creating class ${MOCK_CLASS.id}:`, error);
    }

    // Create irregularities
    const irregularities = [
        { email: MOCK_STUDENTS[0].email, title: 'Phone Usage', message: 'Student was observed using their phone during the session.' },
        { email: MOCK_STUDENTS[1].email, title: 'Distracted', message: 'Student appeared distracted and was not paying attention.' },
        { email: MOCK_STUDENTS[0].email, title: 'Left Seat', message: 'Student left their seat without permission.' },
    ];
    for (const irregularity of irregularities) {
        try {
            await db.collection('irregularities').add({
                classId: MOCK_CLASS.id,
                ...irregularity,
                imageUrl: 'https://via.placeholder.com/150',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (error) {
            console.error('Error creating irregularity record:', error);
        }
    }
    console.log('Successfully created irregularity records.');

    // Create progress records
    for (let i = 0; i < 3; i++) {
        for (const student of MOCK_STUDENTS) {
            try {
                await db.collection('progress').add({
                    classId: MOCK_CLASS.id,
                    email: student.email,
                    progress: `This is sample progress report #${i + 1} for ${student.displayName}. The student is showing improvement in calculus concepts but needs to work on algebra fundamentals.`, 
                    timestamp: admin.firestore.Timestamp.now(),
                });
            } catch (error) {
                console.error(`Error creating progress record for ${student.email}:`, error);
            }
        }
    }
    console.log('Successfully created progress records.');

    // Create Video Library
    for (const video of MOCK_VIDEOS) {
        try {
            await db.collection('videoLibrary').add({
                classId: MOCK_CLASS.id,
                ...video,
                uploadDate: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (error) {
            console.error(`Error creating video library record for ${video.name}:`, error);
        }
    }
    console.log('Successfully created video library records.');

    // Create Playback Records
    try {
        await db.collection('playback').add({
            classId: MOCK_CLASS.id,
            studentEmail: MOCK_STUDENTS[0].email,
            videoUrl: MOCK_VIDEOS[0].videoUrl,
            startTime: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 3600 * 1000)), // 1 hour ago
            endTime: admin.firestore.Timestamp.now(),
            duration: 3500,
        });
        console.log('Successfully created a playback record.');
    } catch (error) {
        console.error('Error creating playback record:', error);
    }

    // Create Screenshot Records
    for (let i = 0; i < 5; i++) {
        try {
            await db.collection('screenshots').add({
                classId: MOCK_CLASS.id,
                studentEmail: MOCK_STUDENTS[i % MOCK_STUDENTS.length].email,
                imageUrl: `https://via.placeholder.com/640x480.png?text=Screenshot+${i+1}`,
                timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 60000))), // every minute for the last 5 mins
            });
        } catch (error) {
            console.error('Error creating screenshot record:', error);
        }
    }
    console.log('Successfully created screenshot records.');

    // Create Notifications
    try {
        // For teacher
        await db.collection('notifications').add({
            userId: users.teacherUsers[0].uid,
            message: `A new irregularity 'Phone Usage' was detected for ${MOCK_STUDENTS[0].email} in class ${MOCK_CLASS.id}.`,
            type: 'irregularity',
            read: false,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            link: `/class/${MOCK_CLASS.id}/irregularities`
        });
        // For student
        await db.collection('notifications').add({
            userId: users.studentUsers[0].uid,
            message: 'A new video Calculus Basics has been added to your library.',
            type: 'info',
            read: false,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            link: `/class/${MOCK_CLASS.id}/videos`
        });
        console.log('Successfully created notification records.');
    } catch (error) {
        console.error('Error creating notification records:', error);
    }
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
  const teacherUsers = await createAuthUsers(auth, MOCK_TEACHERS);
  const studentUsers = await createAuthUsers(auth, MOCK_STUDENTS);

  console.log('\n--- Setting Custom Claims ---');
  for (const teacher of MOCK_TEACHERS) {
      await setTeacherRole(auth, teacher.email);
  }

  console.log('\n--- Creating Firestore Data ---');
  await createFirestoreData(db, { teacherUsers, studentUsers });

  console.log('\nMock data generation finished.');
}

main().catch(error => {
  console.error('An unexpected error occurred:', error);
  process.exit(1);
});
