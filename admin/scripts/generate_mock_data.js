require('dotenv').config({ path: require('path').resolve(__dirname, '../../web-app/.env') });
const admin = require('firebase-admin');
const serviceAccount = require('../sp.json');

// --- CONFIGURATION ---
const MOCK_TEACHERS = [
  { email: 'cywong@vtc.edu.hk', password: 'password', displayName: 'CY Wong' },
];
const MOCK_STUDENTS = Array.from({ length: 10 }, (_, i) => ({
  email: `student${i + 1}@test.com`,
  password: 'password',
  displayName: `Test Student ${i + 1}`,
}));

const today = new Date();
const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
const endDate = new Date(today.getFullYear(), today.getMonth() + 3, 0); // End of 3 months from now

const MOCK_CLASS = {
  id: 'demo-class-101',
  name: 'Demonstration Class 101',
  teachers: MOCK_TEACHERS.map(t => t.email),
  students: MOCK_STUDENTS.map(s => s.email),
  storageQuota: 5 * 1024 * 1024 * 1024, // 5 GB
  schedule: {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    timeZone: 'Asia/Hong_Kong',
    timeSlots: [
      { startTime: '09:00', endTime: '11:00', days: ['Mon', 'Wed'] },
      { startTime: '14:00', endTime: '16:00', days: ['Fri'] }
    ]
  },
  ipRestrictions: [],
  automaticCapture: true,
  automaticCombine: true,
  aiQuota: 1000,
  frameRate: 1,
  imageQuality: 80,
  maxImageSize: 1024,
  isCapturing: false,
  captureStartedAt: null
};

async function createFirestoreData(db, users) {
    console.log('\nCreating Firestore data...');

    const studentUidMap = new Map(users.studentUsers.map(u => [u.email, u.uid]));

    // Create class
    try {
        const { id, ...classData } = MOCK_CLASS;
        const teacherUids = users.teacherUsers.map(u => u.uid);
        const studentUids = users.studentUsers.map(u => u.uid);
        await db.collection('classes').doc(id).set({
            ...classData,
            teacherUids,
            studentUids,
        });
        await db.collection('classes').doc(id).collection('metadata').doc('storage').set({
            storageUsage: 0,
            storageUsageScreenShots: 0,
            storageUsageVideos: 0,
            storageUsageZips: 0,
        });
        await db.collection('classes').doc(id).collection('metadata').doc('ai').set({
            aiUsedQuota: 0,
        });
        console.log(`Successfully created class: ${MOCK_CLASS.id}`);
    } catch (error) {
        console.error(`Error creating class ${MOCK_CLASS.id}:`, error);
    }

    // Create irregularities
    const irregularityTemplates = [
        { title: 'Phone Usage', message: 'Student was observed using their phone during the session.' },
        { title: 'Distracted', message: 'Student appeared distracted and was not paying attention.' },
        { title: 'Left Seat', message: 'Student left their seat without permission.' },
        { title: 'Talking', message: 'Student was talking to another student during the exam.' },
        { title: 'Eyes Wandering', message: 'Student was repeatedly looking away from their screen.' },
    ];

    for (let i = 0; i < 15; i++) {
        try {
            const student = MOCK_STUDENTS[i % MOCK_STUDENTS.length];
            const irregularity = irregularityTemplates[i % irregularityTemplates.length];
            const studentUid = studentUidMap.get(student.email);
            if (!studentUid) continue;
            await db.collection('irregularities').add({
                classId: MOCK_CLASS.id,
                studentUid,
                email: student.email,
                title: irregularity.title,
                message: irregularity.message,
                timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 300000))), // every 5 minutes
            });
        } catch (error) {
            console.error('Error creating irregularity record:', error);
        }
    }
    console.log('Successfully created irregularity records.');

    // Create progress records
    const progressTemplates = [
        "The student is showing excellent progress and is ahead of the curriculum.",
        "Good progress, but needs to focus more on practical exercises.",
        "Struggling with the fundamental concepts. Additional support is recommended.",
        "Making steady progress. Consistent effort is paying off.",
        "Exceptional work on the last assignment. Keep up the great work!",
    ];
    for (const student of MOCK_STUDENTS) {
        for (let i = 0; i < 2; i++) { // 2 progress reports per student
            try {
                const studentUid = studentUidMap.get(student.email);
                if (!studentUid) continue;
                await db.collection('progress').add({
                    classId: MOCK_CLASS.id,
                    studentUid,
                    studentEmail: student.email,
                    progress: `[Report #${i + 1}] ${progressTemplates[(i + student.displayName.length) % progressTemplates.length]}`,
                    timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 7 * 24 * 60 * 60 * 1000))), // weekly
                });
            } catch (error) {
                console.error(`Error creating progress record for ${student.email}:`, error);
            }
        }
    }
    console.log('Successfully created progress records.');

    // Create Screenshot Records
    for (let i = 0; i < 50; i++) {
        try {
            const student = MOCK_STUDENTS[i % MOCK_STUDENTS.length];
            const studentUid = studentUidMap.get(student.email);
            if (!studentUid) continue;
            await db.collection('screenshots').add({
                classId: MOCK_CLASS.id,
                studentUid,
                email: student.email,
                imagePath: `https://via.placeholder.com/640x480.png?text=Screenshot+${i+1}`,
                size: Math.floor(Math.random() * (200 * 1024)) + (50 * 1024), // 50-250 KB
                deleted: false,
                timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 60000))), // every minute for the last 50 mins
            });
        } catch (error) {
            console.error('Error creating screenshot record:', error);
        }
    }
    console.log('Successfully created screenshot records.');

    // Create Notifications
    try {
        // For teacher
        for (let i = 0; i < 5; i++) {
            const student = MOCK_STUDENTS[i % MOCK_STUDENTS.length];
            const irregularity = irregularityTemplates[i % irregularityTemplates.length];
            await db.collection('notifications').add({
                userId: users.teacherUsers[0].uid,
                message: `New irregularity '${irregularity.title}' for ${student.email}.`,
                read: i > 2, // Mark some as read
                timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 60000 * 5))),
            });
        }

        // For students
        for (const student of MOCK_STUDENTS) {
             const studentUid = studentUidMap.get(student.email);
             if (!studentUid) continue;
             await db.collection('notifications').add({
                userId: studentUid,
                message: 'A new video "Advanced Calculus" has been added to your library.',
                read: Math.random() > 0.5,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
             await db.collection('notifications').add({
                userId: studentUid,
                message: 'Reminder: Exam tomorrow at 10:00 AM.',
                read: false,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        console.log('Successfully created notification records.');
    } catch (error) {
        console.error('Error creating notification records:', error);
    }
}


async function createAuthUsers(auth, usersToCreate) {
  const createdUsers = [];
  for (const user of usersToCreate) {
    try {
      let userRecord = await auth.createUser({
        email: user.email,
        password: user.password,
        displayName: user.displayName,
      });
      console.log(`Successfully created user: ${userRecord.email}`);
      createdUsers.push(userRecord);
    } catch (error) {
      if (error.code === 'auth/email-already-exists') {
        console.log(`User ${user.email} already exists. Fetching user record.`);
        const userRecord = await auth.getUserByEmail(user.email);
        createdUsers.push(userRecord);
      } else {
        console.error(`Error creating user ${user.email}:`, error);
      }
    }
  }
  return createdUsers;
}

async function setTeacherRole(auth, email) {
  try {
    const user = await auth.getUserByEmail(email);
    await auth.setCustomUserClaims(user.uid, { role: 'teacher' });
    console.log(`Successfully set teacher role for ${email}`);
  } catch (error) {
    console.error(`Error setting teacher role for ${email}:`, error);
  }
}

function initializeFirebase() {
    if (admin.apps.length === 0) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    return admin;
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
