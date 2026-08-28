import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026';

initializeApp({ projectId });
const auth = getAuth();

// Default teacher emails
const defaultEmails = [
  'cywong@vtc.edu.hk',
  'kcheung@vtc.edu.hk',
  'rontam@vtc.edu.hk',
  'hli852@vtc.edu.hk',
  'kakaleung@vtc.edu.hk',
  'james.chan@vtc.edu.hk',
  'ngmanyiu@vtc.edu.hk',
  'alanpo@vtc.edu.hk'
];

const emails = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultEmails;

console.log(`Granting teacher roles on project: ${projectId}`);

Promise.all(
  emails.map(async (email) => {
    try {
      let userRecord;
      try {
        userRecord = await auth.getUserByEmail(email);
        console.log(`ℹ️ Existing user found: ${email} (UID: ${userRecord.uid})`);
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          console.log(`✨ User does not exist. Creating account for: ${email}...`);
          userRecord = await auth.createUser({
            email,
            password: 'Password123!',
            emailVerified: true,
            displayName: email.split('@')[0]
          });
          console.log(`✅ Created account for ${email} (UID: ${userRecord.uid})`);
        } else {
          throw err;
        }
      }

      await auth.setCustomUserClaims(userRecord.uid, { role: 'teacher' });
      await auth.updateUser(userRecord.uid, { emailVerified: true });
      console.log(`🎉 Successfully granted { role: 'teacher' } to: ${email}`);
    } catch (error) {
      console.error(`❌ Error provisioning ${email}:`, error.message);
    }
  })
).then(() => {
  console.log('✅ All teacher roles processed!');
});
