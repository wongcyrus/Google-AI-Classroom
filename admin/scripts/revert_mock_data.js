require('dotenv').config({ path: require('path').resolve(__dirname, '../../web-app/.env') });
const admin = require('firebase-admin');
const serviceAccount = require('../sp.json');

// --- CONFIGURATION (must match generate_mock_data.js) ---
const MOCK_TEACHERS = [
  { email: 'cywong@vtc.edu.hk' },
];
const MOCK_STUDENTS = Array.from({ length: 10 }, (_, i) => ({
  email: `student${i + 1}@test.com`,
}));
const MOCK_CLASS_ID = 'demo-class-101';

// --- UTILITY FUNCTIONS ---

function initializeFirebase() {
    if (admin.apps.length === 0) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    return admin;
}

async function deleteAuthUsers(auth) {
    console.log('\n--- Deleting Auth Users ---');
    const usersToDelete = [...MOCK_TEACHERS, ...MOCK_STUDENTS].filter(user => user.email !== 'cywong@vtc.edu.hk');
    const promises = usersToDelete.map(async (user) => {
        try {
            const userRecord = await auth.getUserByEmail(user.email);
            await auth.deleteUser(userRecord.uid);
            console.log(`Successfully deleted user: ${user.email}`);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                console.log(`User ${user.email} not found, skipping.`);
            } else {
                console.error(`Error deleting user ${user.email}:`, error);
            }
        }
    });
    await Promise.all(promises);
}

async function deleteCollection(db, collectionPath, batchSize = 100) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(batchSize);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve, reject);
    });
}

async function deleteQueryBatch(db, query, resolve, reject) {
    try {
        const snapshot = await query.get();
        if (snapshot.size === 0) {
            return resolve();
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        process.nextTick(() => {
            deleteQueryBatch(db, query, resolve, reject);
        });
    } catch (error) {
        console.error('Error deleting batch:', error);
        reject(error);
    }
}

async function deleteFirestoreData(db) {
    console.log('\n--- Deleting Firestore Data ---');

    const collectionsToDelete = ['irregularities', 'progress', 'screenshots'];
    for (const collectionName of collectionsToDelete) {
        try {
            const collectionRef = db.collection(collectionName);
            const q = collectionRef.where('classId', '==', MOCK_CLASS_ID);
            const snapshot = await q.get();
            if (snapshot.empty) {
                console.log(`No documents to delete in ${collectionName} for class ${MOCK_CLASS_ID}.`);
                continue;
            }
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            console.log(`Successfully deleted ${snapshot.size} documents from ${collectionName}.`);
        } catch (error) {
            console.error(`Error deleting from ${collectionName}:`, error);
        }
    }

    // Delete teacher notifications (New Schema)
    try {
        const teacher = await admin.auth().getUserByEmail(MOCK_TEACHERS[0].email);
        const messagesPath = `teachers/${teacher.uid}/messages`;
        console.log(`Deleting messages from ${messagesPath}...`);
        await deleteCollection(db, messagesPath);
        console.log(`Successfully deleted messages for teacher ${MOCK_TEACHERS[0].email}.`);
    } catch (error) {
        console.error(`Error finding teacher or deleting messages:`, error);
    }

    // Delete notifications from old schema
    try {
        console.log("Deleting documents from old 'notifications' collection...");
        const usersToDelete = [...MOCK_TEACHERS, ...MOCK_STUDENTS];
        const userRecords = await Promise.all(
            usersToDelete.map(u => admin.auth().getUserByEmail(u.email).catch(() => null))
        );
        const userUids = userRecords.filter(u => u).map(u => u.uid);

        if (userUids.length > 0) {
            // 'in' queries are limited to 30 items. If you have more mock users, this needs batching.
            const collectionRef = db.collection('notifications');
            const q = collectionRef.where('userId', 'in', userUids);
            const snapshot = await q.get();
            if (!snapshot.empty) {
                const batch = db.batch();
                snapshot.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                console.log(`Successfully deleted ${snapshot.size} documents from the old 'notifications' collection.`);
            } else {
                console.log("No documents found in old 'notifications' collection.");
            }
        }
    } catch (error) {
        console.error('Error deleting from old notifications collection:', error);
    }

    // Delete class document and its subcollections
    try {
        const classDocRef = db.collection('classes').doc(MOCK_CLASS_ID);
        await deleteCollection(db, `${classDocRef.path}/metadata`);
        await classDocRef.delete();
        console.log(`Successfully deleted class document: ${MOCK_CLASS_ID}`);
    } catch (error) {
        console.error(`Error deleting class ${MOCK_CLASS_ID}:`, error);
    }
}

// --- MAIN EXECUTION ---
async function main() {
    console.log('*****************************************************************');
    console.log('******************  MOCK DATA REVERT SCRIPT  ******************');
    console.log('*****************************************************************');

    const admin = initializeFirebase();
    const auth = admin.auth();
    const db = admin.firestore();

    await deleteFirestoreData(db);
    await deleteAuthUsers(auth);

    console.log('\nMock data reversion finished.');
}

main().catch(error => {
    console.error('An unexpected error occurred:', error);
    process.exit(1);
});
