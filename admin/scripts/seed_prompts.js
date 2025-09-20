
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin SDK
function initializeFirebase() {
    // Check if the service account key file exists
    const serviceAccountPath = path.join(__dirname, '..', 'sp.json');
    if (!fs.existsSync(serviceAccountPath)) {
        console.error('Error: sp.json not found in the admin directory.');
        console.log('Please download it from your Firebase project settings and place it in the admin directory.');
        process.exit(1);
    }
    const serviceAccount = require(serviceAccountPath);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    return admin;
}

// Seed prompts from the admin/prompts directory
async function seedPrompts(db) {
    const promptsDir = path.join(__dirname, '..', 'prompts');

    // Check if the prompts directory exists
    if (!fs.existsSync(promptsDir)) {
        console.error('Error: prompts directory not found in the admin directory.');
        process.exit(1);
    }

    const files = fs.readdirSync(promptsDir);

    for (const file of files) {
        if (path.extname(file) === '.md') {
            const filePath = path.join(promptsDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const name = path.basename(file, '.md');

            const promptData = {
                name: name,
                promptText: content,
                applyTo: ['Per Image', 'All Images']
            };

            try {
                const docRef = await db.collection('prompts').add(promptData);
                console.log(`Successfully seeded prompt "${name}" with ID: ${docRef.id}`);
            } catch (error) {
                console.error(`Error seeding prompt "${name}":`, error);
            }
        }
    }
}

// Main function to run the script
async function main() {
    console.log('--- Starting to seed prompts from files ---');
    const admin = initializeFirebase();
    const db = admin.firestore();
    await seedPrompts(db);
    console.log('--- Prompt seeding finished ---');
}

main().catch(error => {
    console.error('An unexpected error occurred during prompt seeding:', error);
    process.exit(1);
});
