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
  teacherEmails: MOCK_TEACHERS.map(t => t.email),
  studentEmails: MOCK_STUDENTS.map(s => s.email),
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

    const studentMap = new Map(users.studentUsers.map(u => [u.uid, u.email]));
    const teacherMap = new Map(users.teacherUsers.map(u => [u.uid, u.email]));

    // Create class
    try {
        const { id, studentEmails, teacherEmails, ...classData } = MOCK_CLASS;
        await db.collection('classes').doc(id).set({
            ...classData,
            studentEmails,
            teacherEmails,
            students: Object.fromEntries(studentMap),
            teachers: Object.fromEntries(teacherMap),
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
                        const studentUid = [...studentMap.entries()].find(([, email]) => email === student.email)?.[0];                        if (!studentUid) continue;
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
                            const studentUid = [...studentMap.entries()].find(([, email]) => email === student.email)?.[0];
                            if (!studentUid) continue;
                            await db.collection('progress').add({
                                classId: MOCK_CLASS.id,
                                studentUid,
                                studentEmail: student.email,
                                progress: `[Report #${i + 1}] ${progressTemplates[(i + student.displayName.length) % progressTemplates.length]}`, 
                                timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 60 * 60 * 1000))), // hourly
                            });
                        } catch (error) {
                            console.error(`Error creating progress record for ${student.email}:`, error);
                        }
                    }
                }
            
                // Create Screenshot Records
                for (let i = 0; i < 50; i++) {
                    try {
                        const student = MOCK_STUDENTS[i % MOCK_STUDENTS.length];
                        const studentUid = [...studentMap.entries()].find(([, email]) => email === student.email)?.[0];
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
                        await db.collection('teachers').doc(users.teacherUsers[0].uid).collection('messages').add({
                            classId: MOCK_CLASS.id,
                            message: `New irregularity '${irregularity.title}' for ${student.email}.`,
                            read: i > 2, // Mark some as read
                            timestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 60000 * 5))),
                        });
                    }
            
                    // For students (optional, if students have a similar notification view)
                    for (const student of MOCK_STUDENTS) {
                         const studentUid = [...studentMap.entries()].find(([, email]) => email === student.email)?.[0];
                         if (!studentUid) continue;
                         // This assumes a /students/{uid}/messages subcollection, which may not exist.
                         // Commenting out for now as the primary focus is teacher-side mock data.
                         /*
                         await db.collection('students').doc(studentUid).collection('messages').add({
                            message: 'A new video "Advanced Calculus" has been added to your library.',
                            read: Math.random() > 0.5,
                            timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        });
                         await db.collection('students').doc(studentUid).collection('messages').add({
                            message: 'Reminder: Exam tomorrow at 10:00 AM.',
                            read: false,
                            timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        });
                        */
                    }
                        console.log('Successfully created notification records for teacher.');
                    
                        await createJobData(db, users, studentMap);
                        await createPromptData(db, users);
                    
                    } catch (error) {
                            console.error('Error creating notification records:', error);
                        }
                    }
                    
                    async function createJobData(db, users, studentMap) {
                        console.log('\n--- Creating Job Data ---');
                    
                        // Create Video Jobs
                        const videoJobPromises = MOCK_STUDENTS.map((student, index) => {
                            const studentUid = [...studentMap.entries()].find(([, email]) => email === student.email)?.[0];
                            if (!studentUid) return null;
                    
                            const promises = Array.from({ length: 2 }).map((_, i) => {
                                const status = i === 0 ? 'completed' : (index % 3 === 0 ? 'failed' : 'processing');
                                return db.collection('videoJobs').add({
                                    classId: MOCK_CLASS.id,
                                    studentUid,
                                    studentEmail: student.email,
                                    startTime: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 2 * 60 * 60 * 1000))),
                                    endTime: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (i * 2 * 60 * 60 * 1000) + 3600000)),
                                    status: status,
                                    createdAt: admin.firestore.Timestamp.now(),
                                    videoPath: status === 'completed' ? `mock/videos/${studentUid}_${i}.mp4` : null,
                                    duration: status === 'completed' ? 3598 : null,
                                    size: status === 'completed' ? Math.floor(Math.random() * 20000000) + 5000000 : null,
                                    error: status === 'failed' ? 'FFmpeg exited with code 1' : null,
                                    ffmpegError: status === 'failed' ? 'Sample ffmpeg error log...' : null,
                                });
                            });
                            return Promise.all(promises);
                        });
                        await Promise.all(videoJobPromises.filter(p => p));
                        console.log('Successfully created video jobs.');
                    
                        // Create Zip Jobs
                        await db.collection('zipJobs').add({
                            classId: MOCK_CLASS.id,
                            requester: users.teacherUsers[0].uid,
                            status: 'completed',
                            createdAt: admin.firestore.Timestamp.now(),
                                        zipPath: `mock/zips/archive.zip`,
                                        startTime: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (6 * 60 * 60 * 1000))), // 6 hours ago
                                        endTime: admin.firestore.Timestamp.now(),
                                    });
                                    console.log('Successfully created a zip job.');
                                
                                                    // Create Analysis and AI Jobs
                                                    const aiJobIds = [];
                                                    const aiJobPromises = MOCK_STUDENTS.slice(0, 3).map(student => {
                                                        const studentUid = [...studentMap.entries()].find(([, email]) => email === student.email)?.[0];
                                                        if (!studentUid) return null;
                                                
                                                        const newAiJobRef = db.collection('aiJobs').doc();
                                                        aiJobIds.push(newAiJobRef.id);
                                                        return newAiJobRef.set({
                                                            classId: MOCK_CLASS.id,
                                                            studentUid,
                                                            studentEmail: student.email,
                                                            prompt: 'Analyze student engagement level.',
                                                            status: 'completed',
                                                            result: { engagement: 'high', focus: 'good' },
                                                            createdAt: admin.firestore.Timestamp.now(),
                                                            mediaPaths: [`mock/videos/${studentUid}_0.mp4`],
                                                            deleted: false,
                                                        });
                                                    });
                                                    await Promise.all(aiJobPromises.filter(p => p));
                                                    console.log('Successfully created AI jobs.');
                                                
                                                    await db.collection('videoAnalysisJobs').add({
                                                        classId: MOCK_CLASS.id,
                                                        requester: users.teacherUsers[0].uid,
                                                        prompt: 'Analyze student engagement level.',
                                                        status: 'completed',
                                                        createdAt: admin.firestore.Timestamp.now(),
                                                        startTime: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (3 * 60 * 60 * 1000))), // 3 hours ago
                                                        endTime: admin.firestore.Timestamp.now(),                            filterField: 'createdAt',
                            aiJobIds: aiJobIds,
                            deleted: false,
                        });
                        console.log('Successfully created a video analysis job.');

    // Create Student Status Data
    const statusPromises = MOCK_STUDENTS.map(student => {
        const studentUid = [...studentMap.entries()].find(([, email]) => email === student.email)?.[0];
        if (!studentUid) return null;

        return db.collection('classes').doc(MOCK_CLASS.id).collection('status').doc(studentUid).set({
            isSharing: Math.random() > 0.3, // 70% chance of sharing
            email: student.email,
            name: student.displayName,
            lastUploadTimestamp: admin.firestore.Timestamp.fromDate(new Date(Date.now() - Math.floor(Math.random() * 60000))),
            sessionId: `mock_session_${studentUid}`,
            ipAddress: `192.168.1.${Math.floor(Math.random() * 254) + 1}`
        });
    });
    await Promise.all(statusPromises.filter(p => p));
    console.log('Successfully created student status data.');
                    }
                    
                    async function createPromptData(db, users) {
                        console.log('\n--- Creating Prompt Data ---');
                        const prompts = [
                            { name: 'Summarize Work', category: 'videos', prompt: 'Summarize the student\'s work in this video.', applyTo: ['Per Video'], accessLevel: 'public', owner: 'system' },
                            { name: 'Check for Distractions', category: 'videos', prompt: 'Identify any moments of distraction in this video.', applyTo: ['Per Video'], accessLevel: 'public', owner: 'system' },
                            { name: 'Analyze Resource Usage', category: 'images', prompt: 'Analyze the applications and resources being used in this screenshot.', applyTo: ['Per Image'], accessLevel: 'private', owner: users.teacherUsers[0].uid },
                        ];
                    
                        const promptPromises = prompts.map(p => db.collection('prompts').add({ ...p, createdAt: admin.firestore.Timestamp.now() }));
                        await Promise.all(promptPromises);
                        console.log('Successfully created prompt data.');
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
