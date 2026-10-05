
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin SDK
function initializeFirebase() {
    const serviceAccountPath = path.join(__dirname, '..', 'sp.json');
    let app;
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        app = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Initialized Firebase Admin with sp.json');
    } else {
        const projectId = process.argv[2] || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'it114115-2627';
        app = admin.initializeApp({ projectId });
        console.log(`Initialized Firebase Admin using Application Default Credentials for project: ${projectId}`);
    }
    return { admin, app, db: getFirestore(app) };
}

// Seed prompts from the admin/prompts directory
async function seedPrompts(db) {
    const promptsDir = path.join(__dirname, '..', 'prompts');

    // Check if the prompts directory exists
    if (!fs.existsSync(promptsDir)) {
        console.error('Error: prompts directory not found in the admin directory.');
        process.exit(1);
    }

    // Helper function to recursively get all .md files
    function getMdFiles(dir) {
        let files = [];
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                files = files.concat(getMdFiles(fullPath));
            } else if (path.extname(item) === '.md') {
                files.push(fullPath);
            }
        }
        return files;
    }

    const files = getMdFiles(promptsDir);

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        const name = path.basename(filePath, '.md');
        const category = path.basename(path.dirname(filePath));

        let applyTo;
        if (category === 'images') {
            if (name.includes('Bingo')) {
                applyTo = ['Classroom Bingo Questions'];
            } else if (name.includes('Teacher Screen')) {
                applyTo = ['All Images'];
            } else if (name.includes('Student Screen') || name.includes('Face & Gaze')) {
                applyTo = ['Per Image'];
            } else {
                applyTo = ['Per Image', 'All Images'];
            }
        } else if (category === 'videos') {
            applyTo = ['Per Video'];
        } else if (category === 'audios') {
            if (name.includes('Real-Time') || name.includes('Live Rolling Audio') || name.includes('Rolling Audio') || name.includes('Acoustic Invigilation') || name.includes('Intent Proctor')) {
                applyTo = ['Live Audio Invigilation', 'Live Subtitles & Translation'];
            } else if (name.includes('Lecture Audio') || name.includes('Chapters')) {
                applyTo = ['Lecture STT & Chapters'];
            } else if (name.includes('Gemma')) {
                applyTo = ['On-Device Gemma Voice Intent'];
            } else if (name.includes('Discussion') || name.includes('Long Audio')) {
                applyTo = ['Session Audio Summary'];
            } else {
                applyTo = ['Live Audio Invigilation', 'Session Audio Summary'];
            }
        } else if (category === 'translations') {
            if (name.includes('Lecture Subtitle') || name.includes('Whole-Lecture') || name.includes('Recording') || name.includes('Chapter')) {
                applyTo = ['Lecture Subtitle Translation', 'Lecture Subtitles & Chapters'];
            } else {
                applyTo = ['Live Subtitles & Translation'];
                if (name.includes('Code-Switching')) {
                    applyTo.push('Code-Switching Lectures');
                }
                if (name.includes('Terminology') || name.includes('Clinical') || name.includes('Accounting') || name.includes('Engineering') || name.includes('Gemma')) {
                    applyTo.push('Technical Discipline Glossary');
                }
            }
        } else if (category === 'rubrics') {
            applyTo = ['Lab Rubric Milestones', 'Task Milestones Extraction'];
        } else {
            applyTo = [];
        }

        const promptData = {
            name: name,
            promptText: content,
            category: category,
            applyTo: applyTo,
            accessLevel: 'public',
            isSystem: true,
            owner: 'system',
            lastUpdated: FieldValue.serverTimestamp()
        };

        try {
            const snap = await db.collection('prompts')
                .where('name', '==', name)
                .where('category', '==', category)
                .limit(1)
                .get();
            if (!snap.empty) {
                await snap.docs[0].ref.update(promptData);
                console.log(`Updated existing prompt "${name}" (${category})`);
            } else {
                promptData.createdAt = FieldValue.serverTimestamp();
                const docRef = await db.collection('prompts').add(promptData);
                console.log(`Successfully seeded prompt "${name}" from category "${category}" with ID: ${docRef.id}`);
            }
        } catch (error) {
            console.error(`Error seeding prompt "${name}":`, error);
        }
    }
}

// Main function to run the script
async function main() {
    console.log('--- Starting to seed prompts from files ---');
    const { db } = initializeFirebase();
    await seedPrompts(db);
    console.log('--- Prompt seeding finished ---');
}

main().catch(error => {
    console.error('An unexpected error occurred during prompt seeding:', error);
    process.exit(1);
});
