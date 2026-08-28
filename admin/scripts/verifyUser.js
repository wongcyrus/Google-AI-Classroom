import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026';

initializeApp({ projectId });
const auth = getAuth();

// Add emails to verify here or pass via command line arguments
const defaultEmails = ['cywong@vtc.edu.hk', 't-cywong@stu.vtc.edu.hk'];
const emails = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultEmails;

console.log(`Verifying users on project: ${projectId}`);

Promise.all(
  emails.map(async (email) => {
    try {
      const userRecord = await auth.getUserByEmail(email);
      if (userRecord.emailVerified) {
        console.log(`✅ Email ${email} is already verified.`);
        return;
      }
      await auth.updateUser(userRecord.uid, { emailVerified: true });
      console.log(`✅ Successfully verified email for: ${email}`);
    } catch (error) {
      console.error(`❌ Error verifying user ${email}:`, error.message);
    }
  })
).then(() => {
  console.log('Done!');
});
