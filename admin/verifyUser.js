
const admin = require('firebase-admin');
const serviceAccount = require('./sp.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const emails = ['t-cywong1@stu.vtc.edu.hk']; // Add more emails to this list

emails.forEach(email => {
  admin.auth().getUserByEmail(email)
    .then((userRecord) => {
      if (userRecord.emailVerified) {
        console.log(`Email ${email} is already verified.`);
        return;
      }
      return admin.auth().updateUser(userRecord.uid, {
        emailVerified: true
      }).then(() => {
        console.log(`Successfully verified email for user: ${email}`);
      });
    })
    .catch((error) => {
      console.error(`Error verifying user with email ${email}:`, error);
    });
});
