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
            const studentUid = studentUidMap.get(irregularity.email);
            if (!studentUid) continue;
            await db.collection('irregularities').add({
                classId: MOCK_CLASS.id,
                studentUid,
                email: irregularity.email,
                title: irregularity.title,
                message: irregularity.message,
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
                const studentUid = studentUidMap.get(student.email);
                if (!studentUid) continue;
                await db.collection('progress').add({
                    classId: MOCK_CLASS.id,
                    studentUid,
                    studentEmail: student.email,
                    progress: `This is sample progress report #${i + 1} for ${student.displayName}. The student is showing improvement in calculus concepts but needs to work on algebra fundamentals.`, 
                    timestamp: admin.firestore.Timestamp.now(),
                });
            } catch (error) {
                console.error(`Error creating progress record for ${student.email}:`, error);
            }
        }
    }
    console.log('Successfully created progress records.');

    // Create Screenshot Records
    for (let i = 0; i < 5; i++) {
        try {
            const student = MOCK_STUDENTS[i % MOCK_STUDENTS.length];
            const studentUid = studentUidMap.get(student.email);
            if (!studentUid) continue;
            await db.collection('screenshots').add({
                classId: MOCK_CLASS.id,
                studentUid,
                email: student.email,
                imagePath: `https://via.placeholder.com/640x480.png?text=Screenshot+${i+1}`,
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
